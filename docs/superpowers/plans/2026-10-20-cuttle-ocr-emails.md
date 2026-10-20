# Cuttle: Email Addresses as the OCR Reads Them in a Code Font Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An email address on screen gets its privacy mask also where Windows' OCR reads it in a code editor's monospaced font with its slips: spaces beside a dot, a long dash for a hyphen, a space for an underscore.

While measuring the masks on text that scrolls (#72), a planted address in a code comment was never masked: Windows' OCR read "lena.mueller@example.com" in Consolas, in an editor's string colour, as "I ena .mueller@example . com", and the email rule wants an address without spaces. Measured on a page of addresses (four to a line) in Consolas, Cascadia Mono, Courier New and Segoe UI at 13 and 15 px, in six editor colours, rendered once with the addresses and once without them, read with Windows' OCR:
- 20.6 % of the addresses' pixels were under no mask. Segoe UI lost none; the monospaced fonts lost about one address in four, Courier New at 13 px up to three.
- What the OCR wrote: spaces beside a dot ("company. com", "example . com", "j .doe", "first .last"); a hyphen as a long dash ("firma—beispiel.de", Cascadia Mono); an underscore as a space ("max mustermann@…", where "max" stayed open); an l as "I " ("I ena").
- Also: "@" read as "e" ("first.lastecompany.com", Courier New), and addresses the OCR left out of a line altogether.

**Architecture:** `emailsOf(text)` in `packages/core/src/privacy/patterns.ts` undoes those slips on a copy of the line (a space beside a dot dropped where the part after the dot starts with a lower-case letter or a digit, long dashes made hyphens), keeping each character's place in the line, and finds the addresses there with the rule as before. The word before an address goes with it after a comma, a colon or the line's start (an underscore read as a space), and so does a lone "I" or "l" (an l read as "I "). `findSecrets` takes its email addresses from it; the ranges are the line's, so the masks cover the words the OCR read, spaces and all, and the key that tells an address in another frame drops the spaces as before.

**Tech Stack:** TypeScript, vitest, Windows' OCR and macOS's Vision (the end-to-end test).

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `ocr-emails`, in Git Bash.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions made while planning

- **Undo the slips, not widen the pattern.** The slips are undone on a copy of the line with each character's place kept, and the email pattern is the one it was: it still asks for an "@", a domain and an ending of two letters or more, so a line without an "@" finds nothing new.
- **A space beside a dot only before lower case or a digit.** "example . com", "first. last" and "j .doe" are joined; "lena@example.com. Thanks" is not, nor a sentence that starts after a full stop. A word before an address joined by such a dot is masked with it: a few letters too many, never too few.
- **The word before, only where a list or the line starts.** "max mustermann@…" is masked from "max" after ", " or ": " or at the line's start, so "please write to lena@example.com" keeps "to" clear.
- **What is left as it is.** An "@" read as "e" makes no address (a rule for it would mask code and words); an address the OCR left out is not in its text at all. On the measured page these leave 5.3 % of the addresses' pixels open: addresses the OCR did not write, or wrote with an "e" for the "@" (Courier New).
- Checked on the prototype:
  - The measured page, read with Windows' OCR: 20.6 % of the addresses' pixels under no mask before, 5.3 % after. Each monospaced line lost about one address in four before (up to three in Courier New at 13 px); after, the lines the OCR wrote all four addresses in lose none. Segoe UI lost none before and after.
  - The new tests failed before the change, as Step 3's Expected says, and passed after it.
  - `pnpm test` (1020 passed, 87 skipped) and `pnpm typecheck`.

---

### Task 1: Email addresses as the OCR reads them in a code font

**Files:**
- Create: `packages/core/test/fixtures/privacy/emails.html`, `packages/core/test/fixtures/privacy/emails.png`
- Modify: `packages/core/src/privacy/patterns.ts`, `README.md`
- Test: `packages/core/test/patterns.test.ts`, `packages/core/test/privacy-ocr.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `ocr-emails`; work there:

```bash
git switch ocr-emails
```

- [ ] **Step 2: The editor's page**

Five lines of four addresses in Consolas, Cascadia Mono and Courier New, in an editor's colours:

`packages/core/test/fixtures/privacy/emails.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>Email addresses in an editor (all fake)</title>
<style>
  body { margin: 0; background: #1e1e1e; padding: 32px 48px; }
  div { padding: 4px 8px; white-space: pre; }
  .string { color: #ce9178; }
  .comment { color: #6a9955; }
  .name { color: #9cdcfe; }
  .text { color: #d4d4d4; }
</style>
<div class="string" style="font: 15px/24px Consolas">// contact: lena.mueller@example.com, j.doe+test@mail.example.org, max_mustermann@firma-beispiel.de, first.last@company.com</div>
<div class="string" style="font: 15px/24px 'Cascadia Mono'">// contact: lena.mueller@example.com, j.doe+test@mail.example.org, max_mustermann@firma-beispiel.de, first.last@company.com</div>
<div class="comment" style="font: 15px/24px Consolas">// contact: lena.mueller@example.com, j.doe+test@mail.example.org, max_mustermann@firma-beispiel.de, first.last@company.com</div>
<div class="name" style="font: 15px/24px 'Courier New'">// contact: lena.mueller@example.com, j.doe+test@mail.example.org, max_mustermann@firma-beispiel.de, first.last@company.com</div>
<div class="text" style="font: 13px/20px 'Cascadia Mono'">// contact: lena.mueller@example.com, j.doe+test@mail.example.org, max_mustermann@firma-beispiel.de, first.last@company.com</div>
```

It is rendered at 1920 × 1080 by `cuttle capture-page packages/core/test/fixtures/privacy/emails.html --width 1920 --height 1080 --name emails` in a scratch project, as `secrets.png` was. The render is given as `PAGE`:

```bash
PAGE="${PAGE:?the page rendered by cuttle capture-page}"
cp "$PAGE" packages/core/test/fixtures/privacy/emails.png
```

- [ ] **Step 3: Write the failing tests**

The lines as Windows' OCR read them, and what must stay clear:

In `packages/core/test/patterns.test.ts`, replace:

```ts
    expect(found('Authorization: Bearer abc.def')).toContainEqual(['value', 'Bearer abc.def']);
  });

  it('finds the person\'s words, one wrong letter allowed in long ones', () => {
    expect(found('Thanks, Lena Müller!', ['Lena Müller'])).toEqual([['word', 'Lena Müller!']]);
    expect(found('Lena Mūller wrote', ['Lena Müller'])).toEqual([['word', 'Lena Mūller']]);
```

with:

```ts
    expect(found('Authorization: Bearer abc.def')).toContainEqual(['value', 'Bearer abc.def']);
  });

  it('finds email addresses as Windows OCR reads them in a monospaced font: a space by a dot, a long dash, an underscore as a space', () => {
    // Consolas, Cascadia Mono and Courier New at 13 to 15 px, in an editor's colours (fixtures/privacy/emails.html)
    expect(found('// contact: I ena .mueller@example . com')).toEqual([['email', 'I ena .mueller@example . com']]);
    expect(found('contact: lena.mueller@example.com, j .doe+test@mail.example.org,')).toEqual([
      ['email', 'lena.mueller@example.com'],
      ['email', 'j .doe+test@mail.example.org'],
    ]);
    expect(found('first. last@company. com')).toEqual([['email', 'first. last@company. com']]);
    expect(found('// contact: lena.mueller@example.com, max_musternann@firma—beispiel.de,')).toContainEqual(['email', 'max_musternann@firma—beispiel.de']);
    expect(found('// contact: lena.mueller@example.com, max mustermann@firma-beispiel.de,')).toContainEqual(['email', 'max mustermann@firma-beispiel.de']);
  });

  it('takes no more than the address: not a sentence after it, not the word before it in a sentence', () => {
    expect(found('Mail lena@example.com. Thanks!')).toEqual([['email', 'lena@example.com']]);
    expect(found('please write to lena@example.com')).toEqual([['email', 'lena@example.com']]);
    expect(found('Done. See the docs . then call us')).toEqual([]);
    expect(found("@Component({ selector: 'app' })")).toEqual([]);
  });

  it('finds the person\'s words, one wrong letter allowed in long ones', () => {
    expect(found('Thanks, Lena Müller!', ['Lena Müller'])).toEqual([['word', 'Lena Müller!']]);
    expect(found('Lena Mūller wrote', ['Lena Müller'])).toEqual([['word', 'Lena Mūller']]);
```

The page read with the system's OCR, where there is one (Windows, macOS): each word after "contact:" under a mask:

In `packages/core/test/privacy-ocr.test.ts`, replace:

```ts
    expect(privacyMasks(kept, [], { width: 1920, height: 1080 })).toEqual(masks);
  }, 60_000 + OCR_TIMEOUT.prepare * 1000);

  it('reads frames with several helpers at once, each frame its own text, in order', async () => {
    delete process.env.CUTTLE_OCR;
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-ocr-'));
```

with:

```ts
    expect(privacyMasks(kept, [], { width: 1920, height: 1080 })).toEqual(masks);
  }, 60_000 + OCR_TIMEOUT.prepare * 1000);

  it('masks every email address it reads in an editor in a monospaced font, the spaces and long dashes the OCR reads in them too', async () => {
    delete process.env.CUTTLE_OCR;
    const reader = await ScreenReader.start();
    let lines;
    try {
      // fixtures/privacy/emails.html, rendered at 1920 × 1080 by `cuttle capture-page`: lines of four
      // addresses each in Consolas, Cascadia Mono and Courier New, an editor's colours
      lines = await reader.read(join(import.meta.dirname, 'fixtures', 'privacy', 'emails.png'), 1920, 1080);
    } finally {
      reader.close();
    }
    const masks = privacyMasks([{ t: 1, lines }, { t: 2, lines: [] }, { t: 3, lines: [] }], [], { width: 1920, height: 1080 });
    const under = (rect: Rect) => masks.some((mask) => rect[0] < mask.rect[0] + mask.rect[2] && mask.rect[0] < rect[0] + rect[2] && rect[1] < mask.rect[1] + mask.rect[3] && mask.rect[1] < rect[1] + rect[3]);
    const read = lines.filter((line) => /contact/i.test(line.text));
    expect(read.length, lines.map((line) => line.text).join('\n')).toBeGreaterThanOrEqual(4);
    // after "contact:" a line holds addresses only: each word of it the OCR read is under a mask
    for (const line of read) {
      const start = line.words.findIndex((word) => /contact/i.test(word.text));
      for (const word of line.words.slice(start + 1).filter((one) => /[a-z]/i.test(one.text))) expect(under(word.rect), `"${word.text}" in: ${line.text}`).toBe(true);
    }
  }, 60_000 + OCR_TIMEOUT.prepare * 1000);

  it('reads frames with several helpers at once, each frame its own text, in order', async () => {
    delete process.env.CUTTLE_OCR;
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-ocr-'));
```

Run: `pnpm exec vitest run --project node packages/core/test/patterns.test.ts packages/core/test/privacy-ocr.test.ts`
Expected: FAIL: 2 tests, the slips' lines in `patterns.test.ts` and "first.last@company." on the page; the lines that must stay clear pass.

- [ ] **Step 4: `emailsOf`**

In `packages/core/src/privacy/patterns.ts`, replace:

```ts
  return sum % 10 === 0;
}

interface Match {
  kind: SecretKind;
  from: number;
```

with:

```ts
  return sum % 10 === 0;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * Where the email addresses in a line are (character ranges of `text`), also as the OCR reads them
 * in a monospaced font at an editor's size: a space beside a dot ("example . com", "j .doe",
 * "first. last", the part after the dot in lower case or a digit), a dash read as a long one
 * ("firma—beispiel.de"), an underscore read as a space ("max mustermann@…", the word before taken
 * along after a comma, a colon or the line's start), and an l read as "I " ("I ena.mueller@…").
 */
export function emailsOf(text: string): [number, number][] {
  // the line with those undone, and where each of its characters is in `text`
  let plain = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (/\s/.test(char)) {
      const before = plain.at(-1) ?? '';
      const after = text.slice(i).replace(/^\s+/, '');
      if ((before === '.' && /^[a-z0-9]/.test(after)) || (/[A-Za-z0-9_%+-]/.test(before) && /^\.\s*[a-z0-9]/.test(after))) continue;
    }
    plain += /[‐-―−]/.test(char) ? '-' : char;
    at.push(i);
  }
  const found: [number, number][] = [];
  for (const match of plain.matchAll(EMAIL)) {
    let from = match.index;
    const before = plain.slice(0, from);
    const word = /(?:^|[,;:<(]\s*)([a-z0-9][a-z0-9._%+-]*)\s$/.exec(before) ?? /(?:^|\s)([Il|])\s$/.exec(before);
    if (word) from -= word[1]!.length + 1;
    found.push([at[from]!, at[match.index + match[0].length - 1]! + 1]);
  }
  return found;
}

interface Match {
  kind: SecretKind;
  from: number;
```

In the same file, replace:

```ts
      add(part.slice(0, part.indexOf('-')) as SecretKind, mark.from, marks[last]!.to, part);
    }
  });
  // email addresses
  for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) add('email', match.index, match.index + match[0].length);
  // a token in a link, and a password in one (https://user:password@host)
  for (const match of text.matchAll(/[?&](?:[a-z_]*token|key|api_?key|secret|sig|signature|password|session(?:_?id)?|code)=([^\s&"'#]+)/gi)) add('token', match.index + match[0].length - match[1]!.length, match.index + match[0].length);
  for (const match of text.matchAll(/\/\/[^\s/:@]+:([^\s/@]+)@/g)) add('token', match.index + 2, match.index + match[0].length - 1);
```

with:

```ts
      add(part.slice(0, part.indexOf('-')) as SecretKind, mark.from, marks[last]!.to, part);
    }
  });
  // email addresses, also as the OCR reads them in a monospaced font (`emailsOf`)
  for (const [from, to] of emailsOf(text)) add('email', from, to);
  // a token in a link, and a password in one (https://user:password@host)
  for (const match of text.matchAll(/[?&](?:[a-z_]*token|key|api_?key|secret|sig|signature|password|session(?:_?id)?|code)=([^\s&"'#]+)/gi)) add('token', match.index + match[0].length - match[1]!.length, match.index + match[0].length);
  for (const match of text.matchAll(/\/\/[^\s/:@]+:([^\s/@]+)@/g)) add('token', match.index + 2, match.index + match[0].length - 1);
```

Run: `pnpm exec vitest run --project node packages/core/test/patterns.test.ts packages/core/test/privacy-ocr.test.ts packages/core/test/redact.test.ts packages/core/test/privacy-masks.test.ts`
Expected: PASS (on Windows the macOS helper's 4 tests are skipped).

- [ ] **Step 5: README**

In `README.md`, replace:

```markdown

The text it reads is checked for email addresses, keys and tokens (by their prefixes, by a name
such as `API_KEY=` beside them, or because they look random), IBANs, card and phone numbers and the
words you name. What it finds is kept in the project only as a mark (`⟦key-qwhzbtrk⟧`, one id for
each private thing, also where the OCR read it a little differently), never as it was.

The masks are drawn only into what Cuttle renders (the export, previews). The project folder keeps
the take as it was recorded (`takes/`, the video still shows what the screen showed) and the
```

with:

```markdown

The text it reads is checked for email addresses, keys and tokens (by their prefixes, by a name
such as `API_KEY=` beside them, or because they look random), IBANs, card and phone numbers and the
words you name. Email addresses are found also as the OCR reads them in a code editor's font: with
spaces beside a dot, a long dash for a hyphen or a space for an underscore. What it finds is kept in
the project only as a mark (`⟦key-qwhzbtrk⟧`, one id for each private thing, also where the OCR read
it a little differently), never as it was.

The masks are drawn only into what Cuttle renders (the export, previews). The project folder keeps
the take as it was recorded (`takes/`, the video still shows what the screen showed) and the
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/privacy/patterns.ts packages/core/test/patterns.test.ts packages/core/test/privacy-ocr.test.ts packages/core/test/fixtures/privacy/emails.html packages/core/test/fixtures/privacy/emails.png README.md
git commit -m "privacy: email addresses as the OCR reads them in a code font (a space by a dot, a long dash, an underscore as a space)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: All tests, the typecheck and the checks

- [ ] **Step 1: Run them**

Run: `pnpm test`
Expected: PASS, 1020 passed, 87 skipped.

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 17 tests.

Run: `pnpm app:check`
Expected: PASS, 58 tests.

## Changes during execution

- It was written from the finished prototype and replayed on a fresh clone for its commits; the tree came out byte-identical to the prototype.

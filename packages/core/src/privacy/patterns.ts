// The privacy guard's patterns: what in a line of screen text is private. The text is the OCR's, so
// it is read with its slips in mind: inside digit runs O is 0 and I, l or | is 1 before a checksum,
// a slashed zero reads as ø, and a key's prefix may have one wrong letter. Pure.
import { normWord, type Rect, type ScreenTextLine } from '@cuttle/project';

export const SECRET_KINDS = ['email', 'key', 'token', 'value', 'iban', 'card', 'phone', 'word'] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** What to call a mask over each kind, for people. */
export const SECRET_LABELS: Record<SecretKind, string> = {
  email: 'Email address',
  key: 'Key',
  token: 'Token in a link',
  value: 'Secret value',
  iban: 'IBAN',
  card: 'Card number',
  phone: 'Phone number',
  word: 'Always masked',
};

/** A private thing on a line: its kind, the words it covers (their rect), and its text, compared across frames. */
export interface Secret {
  kind: SecretKind;
  rect: Rect;
  /** The text, normalised (lower case, the OCR's look-alikes made one), to tell the same secret in another frame. */
  key: string;
}

/** After a prefix, a key goes on with at least this many key characters (`rest` says otherwise). */
const KEY_REST = 10;
/**
 * Key prefixes (lower case); one wrong letter is allowed in those of 4 letters or more. `rest`: the
 * key characters that must follow; `plain`: they are letters and digits only (an environment name
 * such as npm_config_cache is not an npm token).
 */
const KEY_PREFIXES: readonly { prefix: string; rest?: number; plain?: true }[] = [
  { prefix: 'sk-ant-' },
  { prefix: 'sk-proj-' },
  { prefix: 'sk-' },
  // Stripe
  { prefix: 'sk_live_', rest: 16 },
  { prefix: 'sk_test_', rest: 16 },
  { prefix: 'rk_live_', rest: 16 },
  { prefix: 'rk_test_', rest: 16 },
  { prefix: 'whsec_', rest: 24 },
  // GitHub, GitLab, Slack
  { prefix: 'ghp_' },
  { prefix: 'gho_' },
  { prefix: 'ghs_' },
  { prefix: 'ghu_' },
  { prefix: 'github_pat_' },
  { prefix: 'glpat-' },
  { prefix: 'xoxb-' },
  { prefix: 'xoxa-' },
  { prefix: 'xoxp-' },
  { prefix: 'xoxs-' },
  // AWS (access keys and temporary ones), Google
  { prefix: 'akia', rest: 16 },
  { prefix: 'asia', rest: 16 },
  { prefix: 'aiza' },
  { prefix: 'ya29.', rest: 30 },
  // Hugging Face, xAI, Groq, Replicate, npm, PyPI
  { prefix: 'hf_', rest: 30, plain: true },
  { prefix: 'xai-', rest: 30, plain: true },
  { prefix: 'gsk_', rest: 30, plain: true },
  { prefix: 'r8_', rest: 30, plain: true },
  { prefix: 'npm_', rest: 30, plain: true },
  { prefix: 'pypi-', rest: 30 },
  // Shopify, DigitalOcean, Linear, SendGrid (SG.<22>.<43>)
  { prefix: 'shpat_', rest: 24, plain: true },
  { prefix: 'shpss_', rest: 24, plain: true },
  { prefix: 'dop_v1_', rest: 40, plain: true },
  { prefix: 'lin_api_', rest: 30, plain: true },
  { prefix: 'sg.', rest: 50 },
  // a JWT
  { prefix: 'eyj' },
];
/** Names whose value is private, in a `NAME=value` or `name: value` line. */
const SECRET_NAMES = /(api[_ -]?key|_key|key\b|token|secret|passw(or)?d|\bpwd\b|session|authorization|\bauth\b|credential|cookie)/i;

/** The OCR's look-alikes of digits, inside a run of digits. */
const DIGIT_LOOKALIKES: Record<string, string> = { o: '0', O: '0', 'ø': '0', 'Ø': '0', I: '1', l: '1', '|': '1' };
/**
 * Text with the look-alikes of digits made digits where they stand next to digits (within two
 * characters, counting those already made digits: "0130 OO" is "0130 00").
 */
export function digitsOf(text: string): string {
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const lookalike = DIGIT_LOOKALIKES[chars[i]!];
    if (lookalike === undefined) continue;
    if ([chars[i - 1], chars[i - 2], chars[i + 1], chars[i + 2]].some((other) => other !== undefined && /[0-9]/.test(other))) chars[i] = lookalike;
  }
  return chars.join('');
}

/** How to compare a secret across frames: lower case, look-alikes made one, no spaces. */
export const keyOf = (text: string) => digitsOf(text).toLowerCase().replace(/[øØo]/g, '0').replace(/[il|]/g, '1').replace(/\s+/g, '');

/** Whether `text` starts with `prefix`, with at most one wrong letter for prefixes of 4 or more. */
function startsLike(text: string, prefix: string): boolean {
  if (text.length < prefix.length) return false;
  let wrong = 0;
  for (let i = 0; i < prefix.length; i++) if (text[i]!.toLowerCase() !== prefix[i]) wrong++;
  return wrong === 0 || (wrong === 1 && prefix.length >= 4);
}

/** The mod 97 check of an IBAN (letters A=10 … Z=35). */
export function ibanValid(iban: string): boolean {
  const compact = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compact)) return false;
  const moved = compact.slice(4) + compact.slice(0, 4);
  let rest = 0;
  for (const char of moved) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}

/** The Luhn check of a card number, and a known issuer's first digits (2221–2720, 3, 4, 5, 6). */
export function cardValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  const lead = Number(digits.slice(0, 4));
  if (!/^[3-6]/.test(digits) && !(lead >= 2221 && lead <= 2720)) return false;
  let sum = 0;
  [...digits].reverse().forEach((char, i) => {
    let digit = Number(char);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  });
  return sum % 10 === 0;
}

interface Match {
  kind: SecretKind;
  from: number;
  to: number;
  text: string;
}

/** The private things of a line of text: character ranges of `text`. */
export function findSecrets(text: string, words: readonly string[] = []): Match[] {
  const found: Match[] = [];
  const add = (kind: SecretKind, from: number, to: number) => found.push({ kind, from, to, text: text.slice(from, to) });

  // email addresses
  for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) add('email', match.index, match.index + match[0].length);
  // a token in a link, and a password in one (https://user:password@host)
  for (const match of text.matchAll(/[?&](?:[a-z_]*token|key|api_?key|secret|sig|signature|password|session(?:_?id)?|code)=([^\s&"'#]+)/gi)) add('token', match.index + match[0].length - match[1]!.length, match.index + match[0].length);
  for (const match of text.matchAll(/\/\/[^\s/:@]+:([^\s/@]+)@/g)) add('token', match.index + 2, match.index + match[0].length - 1);
  // keys by their prefix: the key and what follows on the line
  for (const match of text.matchAll(/[^\s=:"'`(/@]+/g)) {
    const token = match[0];
    const rule = KEY_PREFIXES.find((candidate) => startsLike(token, candidate.prefix));
    if (!rule) continue;
    const { prefix } = rule;
    // a JWT the OCR split with spaces goes on to the line's end: parts with dots between
    const after = prefix === 'eyj' ? text.slice(match.index + prefix.length).replace(/\s+/g, '') : token.slice(prefix.length);
    const rest = rule.plain ? (/^[A-Za-z0-9øØ]*/.exec(after)?.[0] ?? '') : after.replace(/[^A-Za-z0-9_\-.øØ]/g, '');
    if (prefix === 'eyj' && !(rest.length >= 20 && rest.includes('.'))) continue;
    if (rest.length < (rule.rest ?? KEY_REST)) continue;
    add('key', match.index, text.length);
  }
  // a private key's header line
  if (/BEGIN [A-Z ]*PRIVATE KEY/i.test(text)) add('key', 0, text.length);
  // the value of NAME=value or name: value, where the name says it is private
  for (const match of text.matchAll(/([A-Za-z][A-Za-z0-9_ .-]{0,40}?)\s*[=:]\s*(\S)/g)) {
    if (!SECRET_NAMES.test(match[1]!)) continue;
    if (/^https?$/i.test(match[1]!.trim())) continue;
    add('value', match.index + match[0].length - 1, text.length);
  }
  // numbers, with the OCR's look-alikes made digits
  const digits = digitsOf(text);
  for (const match of digits.matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g)) {
    if (ibanValid(match[0])) add('iban', match.index, match.index + match[0].length);
  }
  for (const match of digits.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)) {
    if (cardValid(match[0].replace(/[ -]/g, ''))) add('card', match.index, match.index + match[0].length);
  }
  for (const match of digits.matchAll(/(?:\+\d|\b0\d)[\d ()/-]{7,}\d/g)) {
    const count = match[0].replace(/\D/g, '').length;
    const international = match[0].startsWith('+');
    if ((international && count >= 9 && count <= 15) || (!international && count >= 9 && count <= 13 && !/^0\d{1,3}-\d\d-\d\d/.test(match[0]))) add('phone', match.index, match.index + match[0].length);
  }
  // the person's words, as whole words, one wrong letter allowed in those of 5 or more
  const lower = text.toLowerCase();
  for (const word of words) {
    const parts = word.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const tokens = [...lower.matchAll(/\S+/g)];
    for (let i = 0; i + parts.length <= tokens.length; i++) {
      const same = parts.every((part, k) => {
        const token = normWord(tokens[i + k]![0]);
        const wanted = normWord(part);
        if (token === wanted) return true;
        return wanted.length >= 5 && token.length === wanted.length && [...wanted].filter((char, j) => token[j] !== char).length === 1;
      });
      if (same) add('word', tokens[i]!.index, tokens[i + parts.length - 1]!.index + tokens[i + parts.length - 1]![0].length);
    }
  }
  return found;
}

/**
 * The private things of a line the OCR read, each with the rect of the words it covers. The line's
 * text is its words joined by spaces.
 */
export function lineSecrets(line: ScreenTextLine, words: readonly string[] = []): Secret[] {
  const spans: { from: number; to: number; rect: Rect }[] = [];
  let at = 0;
  for (const word of line.words) {
    spans.push({ from: at, to: at + word.text.length, rect: word.rect });
    at += word.text.length + 1;
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

import { describe, expect, it } from 'vitest';
import type { ScreenTextLine } from '@cuttle/project';
import { cardValid, digitsOf, findSecrets, ibanValid, lineSecrets } from '../src/privacy/patterns';

/** The kinds found in a line, and the text each covers. */
const found = (text: string, words: string[] = []) => findSecrets(text, words).map((secret) => [secret.kind, secret.text]);

describe('findSecrets, on lines as Windows OCR read the fixture page (its slips included)', () => {
  it('finds email addresses, phone numbers, IBANs and card numbers', () => {
    expect(found('Signed in as lena.mueller@example.com')).toEqual([['email', 'lena.mueller@example.com']]);
    expect(found('Phone +49 170 1234567')).toEqual([['phone', '+49 170 1234567']]);
    // "00" read as "OO"
    expect(found('IBAN: DE89 3704 0044 0532 0130 OO')).toContainEqual(['iban', 'DE89 3704 0044 0532 0130 OO']);
    expect(found('Card ending 4111 1111 1111 1111, expires 12/29')).toContainEqual(['card', '4111 1111 1111 1111']);
  });

  it('finds keys by their prefix (one wrong letter allowed) and masks them to the line\'s end', () => {
    expect(found('ANTHROPIC API KEY=sk-ant-apiø3-AbCdEf123456789øGh1jK1mnOpQrStUvWx').map(([kind]) => kind).sort()).toEqual(['key', 'value']);
    expect(found('GITHUB TOKEN=ghp_123456789øabcdefghijk1mnopqrstuvwxyz12')).toContainEqual(['key', 'ghp_123456789øabcdefghijk1mnopqrstuvwxyz12']);
    expect(found('AWS ACCESS KEY ID=AKIAIOSFODNN7EXANPLE')).toContainEqual(['key', 'AKIAIOSFODNN7EXANPLE']);
    // "glpat-" read as "g1pat-", the password in the link (its user@host reads as an email address too)
    const remote = found('origin https://1ena:g1pat-AbCdEf123456GhIjKIMn@git1ab.examp1e.com/demo.git (fetch)');
    expect(remote.map(([kind]) => kind).sort()).toEqual(['email', 'key', 'token']);
    // a JWT the OCR split with spaces, "eyJ" read as "ey3", after a private name
    expect(found('SESSION=ey3hbGc iOiJIUz11NiJ9. zdW1i0i1xmjmø1nø. c21nbmFØdXJ1').map(([kind]) => kind)).toContain('value');
    expect(found('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl')).toContainEqual(['key', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl']);
    expect(found('-----BEGIN OPENSSH PRIVATE KEY-----')).toEqual([['key', '-----BEGIN OPENSSH PRIVATE KEY-----']]);
  });

  it('finds tokens in links, and the value of a private name', () => {
    expect(found('$ curl "https://api.examp1e.com/v1/items?access_token=abc123def456ghi789"')).toContainEqual(['token', 'abc123def456ghi789']);
    expect(found('Password: hunter2 (do not share)')).toEqual([['value', 'hunter2 (do not share)']]);
    expect(found('Authorization: Bearer abc.def')).toContainEqual(['value', 'Bearer abc.def']);
  });

  it('finds the person\'s words, one wrong letter allowed in long ones', () => {
    expect(found('Thanks, Lena Müller!', ['Lena Müller'])).toEqual([['word', 'Lena Müller!']]);
    expect(found('Lena Mūller wrote', ['Lena Müller'])).toEqual([['word', 'Lena Mūller']]);
    expect(found('Lena Meyer wrote', ['Lena Müller'])).toEqual([]);
  });

  it('leaves clean lines alone', () => {
    for (const clean of [
      'Release 2026-10-17, build 4.2.1, 1234 downloadsr call us on Mondays.',
      'Order number 2026101712345 shipped on 17.10.2026.',
      'Author: Lena',
      'The keyboard: great',
      'Use the sk-learn library',
      'Akira wrote this in Aizawa',
      'Call 0800 123',
      'https://example.com/docs',
    ]) expect(found(clean), clean).toEqual([]);
  });
});

describe('the checks', () => {
  it('reads look-alikes as digits only next to digits', () => {
    expect(digitsOf('0130 OO and Olaf')).toBe('0130 00 and Olaf');
    expect(digitsOf('4l11 I111')).toBe('4111 1111');
  });

  it('checks IBANs (mod 97) and card numbers (Luhn, an issuer)', () => {
    expect([ibanValid('DE89 3704 0044 0532 0130 00'), ibanValid('DE88 3704 0044 0532 0130 00')]).toEqual([true, false]);
    expect([cardValid('4111111111111111'), cardValid('4111111111111112'), cardValid('2026101712345')]).toEqual([true, false, false]);
  });
});

describe('lineSecrets', () => {
  it('covers the words a secret is in, and names it to find it again in another frame', () => {
    const line: ScreenTextLine = {
      text: 'Signed in as lena.mueller@example.com',
      rect: [40, 60, 300, 18],
      words: [
        { text: 'Signed', rect: [40, 60, 50, 18] },
        { text: 'in', rect: [94, 60, 14, 18] },
        { text: 'as', rect: [112, 60, 16, 18] },
        { text: 'lena.mueller@example.com', rect: [132, 61, 208, 17] },
      ],
    };
    expect(lineSecrets(line)).toEqual([{ kind: 'email', rect: [132, 61, 208, 17], key: 'email:1ena.mue11er@examp1e.c0m' }]);
  });
});

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { addToPath } from '../src/main/user-path';

// A key of the test's own under HKEY_CURRENT_USER\Software, never the user's environment; deleted after.
const key = `Software\\CuttleTest-${randomBytes(4).toString('hex')}`;
const reg = (...args: string[]) => spawnSync('reg', args, { encoding: 'utf8', windowsHide: true });
const raw = () => {
  // the value as stored: its kind and its unexpanded entries, read the way the app writes it (UTF-8)
  const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key}'); "$($k.GetValueKind('Path'))|$($k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'))"`;
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).stdout.trim();
};

describe.runIf(process.platform === 'win32')('putting a folder on the user’s PATH', () => {
  afterAll(() => {
    reg('delete', `HKCU\\${key}`, '/f');
  });

  it('keeps the value’s kind and its %VAR% entries, adds once, and takes names that are not ASCII', async () => {
    reg('add', `HKCU\\${key}`, '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', '%USERPROFILE%\\probe-a;C:\\probe-b', '/f');
    const place = { key, value: 'Path', broadcast: false };
    expect(await addToPath('C:\\Users\\Jürgen\\Cuttle\\bin', place)).toBe('added');
    expect(raw()).toBe('ExpandString|%USERPROFILE%\\probe-a;C:\\probe-b;C:\\Users\\Jürgen\\Cuttle\\bin');
    // there already: as written, with another case or a trailing backslash, or once %VAR% is expanded
    expect(await addToPath('c:\\users\\jürgen\\cuttle\\bin\\', place)).toBe('present');
    expect(await addToPath(`${process.env.USERPROFILE}\\probe-a`, place)).toBe('present');
    expect(raw()).toBe('ExpandString|%USERPROFILE%\\probe-a;C:\\probe-b;C:\\Users\\Jürgen\\Cuttle\\bin');
  }, 60_000);

  it('makes a missing value REG_EXPAND_SZ', async () => {
    reg('delete', `HKCU\\${key}`, '/v', 'Path', '/f');
    expect(await addToPath('C:\\Tools\\bin', { key, value: 'Path', broadcast: false })).toBe('added');
    expect(raw()).toBe('ExpandString|C:\\Tools\\bin');
  }, 60_000);
});

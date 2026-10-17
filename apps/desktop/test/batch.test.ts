import { describe, expect, it } from 'vitest';
import { batchPath } from '../src/main/batch';

const env = { LOCALAPPDATA: 'C:\\Users\\Jürgen\\AppData\\Local', USERPROFILE: 'C:\\Users\\Jürgen', ProgramFiles: 'C:\\Program Files' };

describe('a path in the cuttle.cmd shim', () => {
  it('names the user’s folders by their variable, so a name like Jürgen stays out of the file', () => {
    expect(batchPath('C:\\Users\\Jürgen\\AppData\\Local\\Programs\\Cuttle\\Cuttle.exe', env)).toBe('%LOCALAPPDATA%\\Programs\\Cuttle\\Cuttle.exe');
    expect(batchPath('C:\\Users\\Jürgen\\repos\\cuttle\\apps\\cli\\dist\\cuttle.mjs', env)).toBe('%USERPROFILE%\\repos\\cuttle\\apps\\cli\\dist\\cuttle.mjs');
    expect(batchPath('C:\\Program Files\\Cuttle\\Cuttle.exe', env)).toBe('%ProgramFiles%\\Cuttle\\Cuttle.exe');
  });

  it('doubles a % (a single one starts a variable) and leaves other paths as they are', () => {
    expect(batchPath('D:\\50% off\\Cuttle.exe', env)).toBe('D:\\50%% off\\Cuttle.exe');
    expect(batchPath('D:\\Tools\\Cuttle.exe', env)).toBe('D:\\Tools\\Cuttle.exe');
  });

  it('has no answer for letters outside ASCII that no variable covers', () => {
    expect(batchPath('D:\\Größe\\Cuttle.exe', env)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { isChord, shortcutFor, shortcutOf } from '../src/shortcuts';

const none = { ctrl: false, alt: false, shift: false, meta: false };
const press = (key: string, held: Partial<typeof none> = {}, special = false) => ({ key, special, ...none, ...held });

describe('shortcutOf', () => {
  it('names a Mac shortcut in the Mac’s symbols and order', () => {
    expect(shortcutOf(press('K', { meta: true }), 'macos')).toEqual(['⌘', 'K']);
    expect(shortcutOf(press('P', { meta: true, shift: true }), 'macos')).toEqual(['⇧', '⌘', 'P']);
    expect(shortcutOf(press('A', { ctrl: true, alt: true, shift: true, meta: true }), 'macos')).toEqual(['⌃', '⌥', '⇧', '⌘', 'A']);
  });

  it('names a Windows shortcut with words, the Windows key first', () => {
    expect(shortcutOf(press('S', { ctrl: true }), 'windows')).toEqual(['Ctrl', 'S']);
    expect(shortcutOf(press('S', { meta: true, shift: true }), 'windows')).toEqual(['Win', 'Shift', 'S']);
    expect(shortcutOf(press('F', { alt: true }), 'windows')).toEqual(['Alt', 'F']);
  });

  it('leaves typing alone: letters alone or with Shift, Option on a Mac, AltGr on Windows', () => {
    expect(shortcutOf(press('A'), 'macos')).toBeUndefined();
    expect(shortcutOf(press('A', { shift: true }), 'windows')).toBeUndefined();
    // ⌥L types @ on a German Mac, AltGr+Q (Ctrl+Alt) on a German Windows keyboard
    expect(shortcutOf(press('L', { alt: true }), 'macos')).toBeUndefined();
    expect(shortcutOf(press('Q', { ctrl: true, alt: true }), 'windows')).toBeUndefined();
    // with the Windows key, Ctrl+Alt is a shortcut again
    expect(shortcutOf(press('Q', { ctrl: true, alt: true, meta: true }), 'windows')).toEqual(['Win', 'Ctrl', 'Alt', 'Q']);
  });

  it('takes the special keys alone and with Shift', () => {
    expect(shortcutOf(press('esc', {}, true), 'macos')).toEqual(['esc']);
    expect(shortcutOf(press('Tab', { shift: true }, true), 'windows')).toEqual(['Shift', 'Tab']);
  });
});

describe('shortcutFor', () => {
  it('names special keys itself and asks the layout only for a shortcut', () => {
    const asked: number[] = [];
    const label = (code: number) => (asked.push(code), code === 0x06 ? 'Z' : undefined);
    expect(shortcutFor('macos', 0x24, none, label)).toEqual(['↩']);
    expect(shortcutFor('macos', 0x06, none, label)).toBeUndefined(); // typing: the layout is not asked
    expect(asked).toEqual([]);
    expect(shortcutFor('macos', 0x06, { ...none, meta: true }, label)).toEqual(['⌘', 'Z']);
    expect(shortcutFor('windows', 0xe04b, { ...none, ctrl: true }, label)).toEqual(['Ctrl', '←']);
    expect(shortcutFor('windows', 0x003b, none, label)).toEqual(['F1']);
    // Backspace alone types; with Ctrl it deletes a word
    expect(shortcutFor('windows', 0x000e, none, label)).toBeUndefined();
    expect(shortcutFor('windows', 0x000e, { ...none, ctrl: true }, label)).toEqual(['Ctrl', 'Backspace']);
    expect(asked).toEqual([0x06]);
  });

  it('logs nothing for a key the layout cannot name', () => {
    expect(shortcutFor('windows', 0x0025, { ...none, ctrl: true }, () => undefined)).toBeUndefined();
  });
});

describe('isChord', () => {
  it('tells a chord from a special key alone', () => {
    expect(isChord(['⌘', 'K'])).toBe(true);
    expect(isChord(['Ctrl', 'Shift', 'P'])).toBe(true);
    expect(isChord(['esc'])).toBe(false);
    expect(isChord(['Shift', 'Tab'])).toBe(false);
  });
});

// Keys as each system writes them: "Ctrl+Shift+Z" on Windows. On a Mac the editor's shortcuts take
// ⌘ (each Ctrl shortcut also takes it, and ⌘ is what people press there) and the recording hotkeys
// are Control+Shift+Option+letter; both in the Mac's symbols and order (⌃⌥⇧⌘), without pluses.
const MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh');

const SYMBOLS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Cmd: '⌘' };
const ORDER = ['⌃', '⌥', '⇧', '⌘'];

function macKeys(keys: string, ctrl: string): string[] {
  const parts = keys.split('+').map((key) => (key === 'Ctrl' ? ctrl : (SYMBOLS[key] ?? key)));
  const modifiers = parts.filter((part) => ORDER.includes(part)).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return [...modifiers, ...parts.filter((part) => !ORDER.includes(part))];
}

/** An editor shortcut ("Ctrl+K"): "⌘K" on a Mac. */
export const shortcut = (keys: string) => (MAC ? macKeys(keys, '⌘').join('') : keys);
/** A recording hotkey ("Ctrl+Shift+Alt+S"): "⌃⌥⇧S" on a Mac. */
export const hotkey = (keys: string) => (MAC ? macKeys(keys, '⌃').join('') : keys);
/** A recording hotkey's keys one by one, for a chip each: ⌃ ⌥ ⇧ S on a Mac. */
export const hotkeyKeys = (keys: string) => (MAC ? macKeys(keys, '⌃') : keys.split('+'));

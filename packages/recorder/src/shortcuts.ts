// Which key presses are shortcuts, and how each system writes them. A shortcut is a key pressed with
// Cmd or Ctrl (on Windows also Alt or the Windows key), or one of the keys that type nothing on
// their own (Esc, Enter, Tab, the arrows, F1–F12), with or without Shift. A letter typed alone or
// with Shift is typing: it is counted (events.ts), never named. Option on a Mac and AltGr on Windows
// (Ctrl+Alt) type characters (@, {, ~), so they do not make a shortcut of a letter either.
import type { Platform } from './sources';

/** A key press as both input sources report it, with the key's name on this keyboard. */
export interface KeyPress {
  /** The key itself as the keyboard shows it: a letter or digit of the layout, or a special key's name. */
  key: string;
  /** A key that types nothing (Esc, Enter, Tab, an arrow, F1–F12…): a shortcut alone too. */
  special: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Cmd on a Mac, the Windows key on Windows. */
  meta: boolean;
}

/** The modifier keys' names, as each system writes them, in its order (⌃⌥⇧⌘; Win+Ctrl+Alt+Shift). */
const MAC_MODIFIERS = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' } as const;
const WINDOWS_MODIFIERS = { meta: 'Win', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' } as const;

export type Modifiers = Pick<KeyPress, 'ctrl' | 'alt' | 'shift' | 'meta'>;

/** Whether the modifiers make any key a shortcut: Cmd or Ctrl on a Mac (Option types), Ctrl, Alt or Win on Windows but AltGr. */
function chordHeld(held: Modifiers, platform: Platform): boolean {
  // a Mac types with Option; Windows types with AltGr, which reaches apps as Ctrl+Alt
  return platform === 'macos' ? held.meta || held.ctrl : (held.ctrl || held.alt || held.meta) && !(held.ctrl && held.alt && !held.meta);
}

/**
 * The keys of a shortcut, as the system the take is recorded on writes them (`['⌘', '⇧', 'P']`,
 * `['Ctrl', 'Shift', 'P']`), or undefined when the press is typing.
 */
export function shortcutOf(press: KeyPress, platform: Platform): string[] | undefined {
  const mac = platform === 'macos';
  if (!chordHeld(press, platform) && !press.special) return undefined;
  const names = mac ? MAC_MODIFIERS : WINDOWS_MODIFIERS;
  const held = (Object.keys(names) as (keyof typeof names)[]).filter((modifier) => press[modifier]).map((modifier) => names[modifier]);
  return [...held, press.key];
}

/** Whether the keys hold a modifier other than Shift: @cuttle/project's, where the timeline reads it too. */
export { isChord } from '@cuttle/project';

type Named = { key: string; special: boolean };

const fKeys = (codes: readonly number[]): [number, Named][] => codes.map((code, i) => [code, { key: `F${i + 1}`, special: true }]);

/**
 * macOS virtual key codes (kVK_…) of the keys with a name of their own; every other key is named by
 * the layout (darwin.ts, `keyLabel`). Space, Delete and Forward Delete type or change text on their
 * own, so only a chord makes them a shortcut.
 */
const MAC_NAMED = new Map<number, Named>([
  [0x24, { key: '↩', special: true }],
  [0x4c, { key: '↩', special: true }],
  [0x30, { key: '⇥', special: true }],
  [0x35, { key: 'esc', special: true }],
  [0x7b, { key: '←', special: true }],
  [0x7c, { key: '→', special: true }],
  [0x7d, { key: '↓', special: true }],
  [0x7e, { key: '↑', special: true }],
  [0x73, { key: '↖', special: true }],
  [0x77, { key: '↘', special: true }],
  [0x74, { key: '⇞', special: true }],
  [0x79, { key: '⇟', special: true }],
  [0x31, { key: 'Space', special: false }],
  [0x33, { key: '⌫', special: false }],
  [0x75, { key: '⌦', special: false }],
  ...fKeys([0x7a, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6d, 0x67, 0x6f]),
]);

/**
 * uiohook's key codes (the keyboard's scan codes, 0x0E00 above them for the extended keys) of the
 * keys with a name of their own on Windows; every other key is named by the layout (win32.ts).
 */
const WINDOWS_NAMED = new Map<number, Named>([
  [0x001c, { key: 'Enter', special: true }],
  [0x0e1c, { key: 'Enter', special: true }],
  [0x000f, { key: 'Tab', special: true }],
  [0x0001, { key: 'Esc', special: true }],
  [0xe04b, { key: '←', special: true }],
  [0xe04d, { key: '→', special: true }],
  [0xe050, { key: '↓', special: true }],
  [0xe048, { key: '↑', special: true }],
  [0x0e47, { key: 'Home', special: true }],
  [0x0e4f, { key: 'End', special: true }],
  [0x0e49, { key: 'PgUp', special: true }],
  [0x0e51, { key: 'PgDn', special: true }],
  [0x0039, { key: 'Space', special: false }],
  [0x000e, { key: 'Backspace', special: false }],
  [0x0e53, { key: 'Del', special: false }],
  ...fKeys([0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41, 0x42, 0x43, 0x44, 0x57, 0x58]),
]);

/** A key with a name of its own on this system (Enter, ←, F5…), else undefined: the layout names it. */
export function namedKey(platform: Platform, code: number): Named | undefined {
  return (platform === 'macos' ? MAC_NAMED : WINDOWS_NAMED).get(code);
}

/**
 * The shortcut a key (the input source's code) makes with the modifiers held, or undefined for
 * typing. `label` names a key without a name of its own from the keyboard's layout; it is asked only
 * for a shortcut, never for a letter typed.
 */
export function shortcutFor(platform: Platform, code: number, held: Modifiers, label: (code: number) => string | undefined): string[] | undefined {
  const named = namedKey(platform, code);
  if (!named?.special && !chordHeld(held, platform)) return undefined;
  const key = named?.key ?? label(code);
  return key === undefined ? undefined : shortcutOf({ key, special: named?.special ?? false, ...held }, platform);
}

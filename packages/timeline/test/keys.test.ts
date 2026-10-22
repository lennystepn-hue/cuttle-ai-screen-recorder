import { describe, expect, it } from 'vitest';
import { parseProject } from '@cuttle/project';
import { KEY_HOLD_SECONDS, createTimeline, keyBadgeAt, keyGroups, shortcutsOf } from '../src/index';

const shortcuts = [
  { t: 2, keys: ['⌘', 'K'] },
  { t: 2.6, keys: ['⌘', 'Z'] },
  { t: 3.2, keys: ['⌘', 'Z'] },
  { t: 3.9, keys: ['⌘', 'Z'] },
  { t: 8, keys: ['esc'] },
  { t: 12, keys: ['⇧', '⌘', 'P'] },
];

describe('keyGroups', () => {
  it('joins the same shortcut pressed again within a second, and leaves special keys alone out unless asked', () => {
    expect(keyGroups(shortcuts, 'shortcuts').map((group) => [group.keys.join(''), group.presses])).toEqual([
      ['⌘K', [2]],
      ['⌘Z', [2.6, 3.2, 3.9]],
      ['⇧⌘P', [12]],
    ]);
    expect(keyGroups(shortcuts, 'keys').map((group) => group.keys.join(''))).toEqual(['⌘K', '⌘Z', 'esc', '⇧⌘P']);
  });
});

describe('keyBadgeAt', () => {
  const groups = keyGroups(shortcuts, 'shortcuts');

  it('shows the last shortcut pressed, with its count so far, while it holds', () => {
    expect(keyBadgeAt(groups, 1.9, 1)).toBeUndefined();
    expect(keyBadgeAt(groups, 2.3, 1)).toMatchObject({ keys: ['⌘', 'K'], count: 1, opacity: 1 });
    // a newer one takes its place at once
    expect(keyBadgeAt(groups, 2.7, 1)).toMatchObject({ keys: ['⌘', 'Z'], count: 1 });
    expect(keyBadgeAt(groups, 3.5, 1)).toMatchObject({ keys: ['⌘', 'Z'], count: 2 });
    expect(keyBadgeAt(groups, 4, 1)).toMatchObject({ keys: ['⌘', 'Z'], count: 3 });
    // it holds after the last press, fading out at the end
    expect(keyBadgeAt(groups, 3.9 + KEY_HOLD_SECONDS - 0.1, 1)!.opacity).toBeCloseTo(1 / 3, 5);
    expect(keyBadgeAt(groups, 3.9 + KEY_HOLD_SECONDS + 0.01, 1)).toBeUndefined();
  });

  it('comes in over a moment, and holds as long on screen in a clip at 2×', () => {
    expect(keyBadgeAt(groups, 12.06, 1)!.opacity).toBeCloseTo(0.5, 5);
    expect(keyBadgeAt(groups, 12 + 2 * (KEY_HOLD_SECONDS - 0.05), 2)).toBeDefined();
    expect(keyBadgeAt(groups, 12 + 2 * KEY_HOLD_SECONDS + 0.01, 2)).toBeUndefined();
  });

  it('shows none in waiting sped up', () => {
    expect(keyBadgeAt(groups, 2.3, 12)).toBeUndefined();
  });
});

describe('the badges in the timeline', () => {
  const make = (keys: Record<string, unknown> = {}) => {
    const result = parseProject({ version: 1, sources: { screen: 's.mp4' }, look: { transition: { enabled: false }, keys }, scenes: [{ type: 'clip', from: 0, to: 20 }] });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    return result.project;
  };
  const screenSize = { width: 1920, height: 1080 };

  it('puts the badge on the frame, and none when the look switches them off', () => {
    expect(createTimeline(make(), { screenSize, shortcuts }).frameAt(2.3).keys).toMatchObject({ keys: ['⌘', 'K'] });
    expect(createTimeline(make({ enabled: false }), { screenSize, shortcuts }).frameAt(2.3).keys).toBeUndefined();
    expect(createTimeline(make(), { screenSize }).frameAt(2.3).keys).toBeUndefined();
  });

  it('reads the shortcuts among the input events', () => {
    expect(shortcutsOf([{ t: 1, type: 'keys', count: 3 }, { t: 2, type: 'shortcut', keys: ['Ctrl', 'S'] }])).toEqual([{ t: 2, keys: ['Ctrl', 'S'] }]);
  });
});

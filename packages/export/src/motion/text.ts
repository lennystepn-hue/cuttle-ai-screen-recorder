/// <reference lib="dom" />
// What a motion page shows as text, for `cuttle review`: run in the page (MotionPage.text injects
// this function's source), so it must not use anything from outside itself.

/** A block of text a page shows in a frame (CSS px, which are the output's). */
export interface PageText {
  /** The block's number in its page, the same in every frame of the showing. */
  id: number;
  /** Its visible words, spaces collapsed. */
  text: string;
  /**
   * The size of its letters: the middle height of their line boxes over 1.2 (a font's ascent and
   * descent are about 1.2 em), so a transform that scales the text scales it too.
   */
  size: number;
  rect: [x: number, y: number, width: number, height: number];
}

/**
 * The text the page shows now, by block (the nearest ancestor that is not inline): the text nodes
 * that show, without those that are hidden, nearly transparent or off the page. Text split into a
 * span per word or letter reads as its block's.
 */
export function visibleText(): PageText[] {
  const page = window as unknown as { __cuttleTextIds?: WeakMap<Element, number>; __cuttleTextCount?: number };
  const ids = (page.__cuttleTextIds ??= new WeakMap<Element, number>());
  const shown = new Map<Element, number>();
  /** The opacity an element shows with, its ancestors' included. */
  const opacity = (element: Element): number => {
    const known = shown.get(element);
    if (known !== undefined) return known;
    const style = getComputedStyle(element);
    let value = style.visibility === 'hidden' || style.display === 'none' ? 0 : Number(style.opacity);
    if (value > 0 && element.parentElement) value *= opacity(element.parentElement);
    shown.set(element, value);
    return value;
  };
  const blocks = new Map<Element, { words: string[]; heights: number[]; left: number; top: number; right: number; bottom: number }>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ');
    const parent = node.parentElement;
    if (text.trim() === '' || !parent || parent.closest('script, style, noscript, template') || opacity(parent) < 0.5) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const lines = Array.from(range.getClientRects()).filter((line) => line.width >= 1 && line.height >= 1 && line.right > 0 && line.bottom > 0 && line.left < innerWidth && line.top < innerHeight);
    if (lines.length === 0) continue;
    let block: Element = parent;
    while (block !== document.body && block.parentElement && getComputedStyle(block).display.startsWith('inline')) block = block.parentElement;
    const entry = blocks.get(block) ?? { words: [], heights: [], left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    entry.words.push(text);
    for (const line of lines) {
      entry.heights.push(line.height);
      entry.left = Math.min(entry.left, line.left);
      entry.top = Math.min(entry.top, line.top);
      entry.right = Math.max(entry.right, line.right);
      entry.bottom = Math.max(entry.bottom, line.bottom);
    }
    blocks.set(block, entry);
  }
  return [...blocks].map(([block, entry]) => {
    let id = ids.get(block);
    if (id === undefined) {
      id = page.__cuttleTextCount = (page.__cuttleTextCount ?? 0) + 1;
      ids.set(block, id);
    }
    const round = (value: number) => Math.round(value * 10) / 10;
    return {
      id,
      text: entry.words.join('').replace(/\s+/g, ' ').trim(),
      size: round(entry.heights.sort((a, b) => a - b)[Math.floor(entry.heights.length / 2)]! / 1.2),
      rect: [round(entry.left), round(entry.top), round(entry.right - entry.left), round(entry.bottom - entry.top)],
    };
  });
}

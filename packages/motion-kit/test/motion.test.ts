import { describe, expect, it } from 'vitest';
import { alpha, at, bezier, ease, highlight, inOut, keys, mix, random, spring, stagger, typed, typedUntil } from '../kit/motion.js';

describe("Cuttle's motion helpers", () => {
  it('ease from 0 to 1, as CSS does', () => {
    for (const curve of Object.values(ease)) {
      expect(curve(0)).toBeCloseTo(0, 6);
      expect(curve(1)).toBeCloseTo(1, 6);
    }
    // cubic-bezier(0.25, 0.1, 0.25, 1) at x = 0.5 (the browser's own value)
    expect(ease.css(0.5)).toBeCloseTo(0.8024, 3);
    expect(bezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 5);
    expect(ease.outBack(0.6)).toBeGreaterThan(1);
  });

  it('spring to 1 and settle there', () => {
    expect(spring(0)).toBe(0);
    expect(Math.max(...[0.1, 0.2, 0.3, 0.4].map((s) => spring(s)))).toBeGreaterThan(1);
    expect(spring(2)).toBeCloseTo(1, 3);
    expect(spring(2, { damping: 40 })).toBeCloseTo(1, 3);
  });

  it('say how far an animation is, and ramp in and out', () => {
    expect([at(0.5, 1, 1), at(1.5, 1, 1, ease.linear), at(3, 1, 1)]).toEqual([0, 0.5, 1]);
    expect(at(1, 1, 0)).toBe(1);
    expect([inOut(0, 1, 3, 0.5), inOut(2, 1, 3, 0.5), inOut(3, 1, 3, 0.5)]).toEqual([0, 1, 0]);
    expect(inOut(2.75, 1, 3, 0.5, 0.5, ease.linear)).toBeCloseTo(0.5, 6);
  });

  it('go through keyframes of numbers, lists and colours', () => {
    const frames: [number, number, ((t: number) => number)?][] = [[0, 0], [1, 10, ease.linear], [2, 0, ease.linear]];
    expect([keys(-1, frames), keys(0.5, frames), keys(1.5, frames), keys(5, frames)]).toEqual([0, 5, 5, 0]);
    expect(keys(0.5, [[0, [0, 100]], [1, [10, 0], ease.linear]])).toEqual([5, 50]);
    expect(keys(0.5, [[0, '#000000'], [1, '#ffffff', ease.linear]])).toBe('#808080');
    expect(mix('#d97757', '#ffffff', 0)).toBe('#d97757');
    expect(alpha('#d97757', 0.5)).toBe('rgba(217, 119, 87, 0.5)');
  });

  it('stagger from the start, the end, the middle or an index', () => {
    expect([0, 1, 2, 3, 4].map((i) => stagger(i, 5, 0.1))).toEqual([0, 0.1, 0.2, 0.30000000000000004, 0.4]);
    expect([0, 1, 2, 3, 4].map((i) => stagger(i, 5, 1, 'center'))).toEqual([2, 1, 0, 1, 2]);
    expect(stagger(0, 5, 1, 'end')).toBe(4);
  });

  it('give the same random numbers for the same seed', () => {
    const a = random(7);
    const b = random(7);
    const numbers = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(numbers);
    expect(random(8)()).not.toBe(numbers[0]);
  });

  it('type text with a rhythm, and know when it is done', () => {
    const text = 'Hi, you.\nOk';
    expect(typed(text, 0)).toBe('');
    expect(typed(text, 0.03, { cps: 40 })).toBe('H');
    expect(typed(text, 100)).toBe(text);
    const done = typedUntil(text, { start: 1, cps: 20 });
    expect(typed(text, done - 0.001, { start: 1, cps: 20 })).toBe(text.slice(0, -1));
    expect(typed(text, done, { start: 1, cps: 20 })).toBe(text);
  });

  it('colour code by its tokens', () => {
    expect(highlight('const x = await load("a"); // done', 'ts')).toBe(
      '<span class="tok-keyword">const</span> x <span class="tok-punct">=</span> <span class="tok-keyword">await</span> <span class="tok-function">load</span><span class="tok-punct">(</span><span class="tok-string">"a"</span><span class="tok-punct">);</span> <span class="tok-comment">// done</span>',
    );
    expect(highlight('{ "name": "Cuttle", "fast": true }', 'json')).toBe(
      '<span class="tok-punct">{</span> <span class="tok-attr">"name"</span><span class="tok-punct">:</span> <span class="tok-string">"Cuttle"</span><span class="tok-punct">,</span> <span class="tok-attr">"fast"</span><span class="tok-punct">:</span> <span class="tok-keyword">true</span> <span class="tok-punct">}</span>',
    );
    expect(highlight('def run(n): # go', 'python')).toBe('<span class="tok-keyword">def</span> <span class="tok-function">run</span><span class="tok-punct">(</span>n<span class="tok-punct">):</span> <span class="tok-comment"># go</span>');
    expect(highlight('<a href="/x">Hi & bye</a>', 'html')).toBe(
      '<span class="tok-punct">&lt;</span><span class="tok-tag">a</span> <span class="tok-attr">href</span><span class="tok-punct">=</span><span class="tok-string">"/x"</span><span class="tok-punct">&gt;</span>Hi &amp; bye<span class="tok-punct">&lt;/</span><span class="tok-tag">a</span><span class="tok-punct">&gt;</span>',
    );
  });
});

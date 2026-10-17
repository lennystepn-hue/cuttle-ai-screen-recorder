import { afterEach, describe, expect, it } from 'vitest';
import { motionRuntime, type CuttleApi, type MotionInit } from '../src/motion/runtime';

const INIT: MotionInit = {
  duration: 2,
  fps: 30,
  width: 320,
  height: 180,
  format: '16:9',
  params: { title: 'Hi' },
  theme: { '--cuttle-accent': '#d97757' },
  seed: 7,
};

type Page = Window &
  typeof globalThis & {
    cuttle: CuttleApi;
    __cuttleDraw(ms: number): Promise<number>;
    __cuttleReady(): Promise<void>;
    __cuttleErrors: string[];
    seen: unknown[];
  };

const frames: HTMLIFrameElement[] = [];
afterEach(() => frames.splice(0).forEach((frame) => frame.remove()));

/**
 * A page in an iframe, as the renderer makes one: the runtime from its source text first (so it
 * must not need anything from outside itself), then the page's markup and script.
 */
function page(markup: string, script: string, init = INIT): Page {
  const frame = document.createElement('iframe');
  frame.style.cssText = `width:${init.width}px;height:${init.height + 4}px;border:0`;
  document.body.append(frame);
  frames.push(frame);
  const win = frame.contentWindow as Page;
  win.eval(`(${motionRuntime.toString()})(${JSON.stringify(init)});`);
  win.seen = [];
  win.document.body.innerHTML = markup;
  win.eval(script);
  return win;
}

describe('the motion runtime', () => {
  it('runs the page on its own clock: time, timers and animation frames move only when a frame is drawn', async () => {
    const win = page(
      '',
      `setTimeout(() => seen.push(['timeout', performance.now()]), 100);
       setInterval(() => seen.push(['interval', performance.now()]), 200);
       requestAnimationFrame((t) => seen.push(['frame', t, Date.now() - Date.UTC(2026, 0, 1)]));`,
    );
    expect(win.performance.now()).toBe(0);
    expect(win.Date.now()).toBe(Date.UTC(2026, 0, 1));
    expect(new win.Date().getTime()).toBe(Date.UTC(2026, 0, 1));
    await new Promise((done) => setTimeout(done, 150));
    expect(win.seen).toEqual([]);
    expect(await win.__cuttleDraw(500)).toBe(1);
    expect(win.seen).toEqual([
      ['timeout', 100],
      ['interval', 200],
      ['interval', 400],
      ['frame', 500, 500],
    ]);
    expect(win.cuttle.time).toBe(0.5);
    // never back: an earlier time leaves the clock where it is
    await win.__cuttleDraw(200);
    expect(win.performance.now()).toBe(500);
  });

  it('sets every CSS animation and Web Animation to the time since it first showed, paused', async () => {
    const win = page(
      `<style>@keyframes slide { to { transform: translateX(100px) } } #css { animation: slide 1s linear forwards }</style>
       <div id="css"></div><div id="waapi"></div>`,
      `document.getElementById('waapi').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, fill: 'forwards' });`,
    );
    await win.__cuttleDraw(0);
    await win.__cuttleDraw(250);
    const animation = (id: string) => win.document.getElementById(id)!.getAnimations()[0]!;
    const css = animation('css');
    const waapi = animation('waapi');
    expect(css.currentTime).toBe(250);
    expect(waapi.currentTime).toBe(250);
    expect(css.playState).toBe('paused');
    expect(win.getComputedStyle(win.document.getElementById('waapi')!).opacity).toBe('0.25');
    expect(win.getComputedStyle(win.document.getElementById('css')!).transform).toBe('matrix(1, 0, 0, 1, 25, 0)');
  });

  it('gives the page window.cuttle: its time, size, params and theme, and a draw call for every frame', async () => {
    const win = page('<div id="accent" style="color: var(--cuttle-accent)"></div>', `cuttle.onFrame((t) => seen.push(t));`);
    expect(win.cuttle).toMatchObject({ duration: 2, fps: 30, size: { width: 320, height: 180 }, format: '16:9', params: { title: 'Hi' } });
    expect(win.getComputedStyle(win.document.getElementById('accent')!).color).toBe('rgb(217, 119, 87)');
    await win.__cuttleDraw(0);
    await win.__cuttleDraw(1000 / 30);
    expect(win.seen).toEqual([0, 1 / 30]);
  });

  it('seeds Math.random: the same seed gives the same numbers', () => {
    const numbers = (seed: number) => page('', 'seen.push(Math.random(), Math.random(), Math.random())', { ...INIT, seed }).seen;
    const first = numbers(7);
    expect(numbers(7)).toEqual(first);
    expect(numbers(8)).not.toEqual(first);
    expect(first.every((n) => typeof n === 'number' && n >= 0 && n < 1)).toBe(true);
  });

  it('marks each drawn frame below the page with its number', async () => {
    const win = page('', '');
    await win.__cuttleDraw(0);
    expect(await win.__cuttleDraw(0)).toBe(2);
    const marker = [...win.document.documentElement.children].find((element) => (element as HTMLElement).style.top === '180px') as HTMLElement;
    expect(marker.style.background).toBe('rgb(2, 0, 200)');
  });

  it('notes what the page throws and goes on; a timeout that sets itself again cannot stall a frame', async () => {
    const win = page('', `cuttle.onFrame(() => { throw new TypeError('no title'); }); const again = () => setTimeout(again, 0); again(); Promise.reject(new Error('lost'));`);
    expect(await win.__cuttleDraw(100)).toBe(1);
    await new Promise((done) => setTimeout(done, 0));
    expect(win.__cuttleErrors).toEqual(expect.arrayContaining(['TypeError: no title', 'Error: lost']));
  });

  it('waits for what the page asks to wait for before its first frame', async () => {
    const win = page('', `let release; cuttle.ready(new Promise((done) => (release = done))); window.release = () => release();`);
    let ready = false;
    void win.__cuttleReady().then(() => (ready = true));
    await new Promise((done) => setTimeout(done, 50));
    expect(ready).toBe(false);
    (win as unknown as { release(): void }).release();
    await new Promise((done) => setTimeout(done, 0));
    expect(ready).toBe(true);
  });
});

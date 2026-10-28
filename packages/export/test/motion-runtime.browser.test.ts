import { afterEach, describe, expect, it } from 'vitest';
import { motionRuntime, type CuttleApi, type MotionInit, type TakeData } from '../src/motion/runtime';

const INIT: MotionInit = {
  duration: 2,
  start: 0,
  fps: 30,
  width: 320,
  height: 180,
  format: '16:9',
  params: { title: 'Hi' },
  theme: { '--cuttle-accent': '#d97757' },
  seed: 7,
  fonts: [{ family: 'Inter', weight: '700', style: 'normal', src: 'cuttle-motion://kit/fonts/inter-latin-700-normal.woff2' }],
  take: null,
};

type Page = Window &
  typeof globalThis & {
    cuttle: CuttleApi;
    __cuttleDraw(ms: number, view?: import('../src/motion/runtime').MotionView | null, between?: { from: string; to: string }): Promise<number>;
    __cuttleReady(): Promise<void>;
    __cuttleErrors: string[];
    __cuttleSounds: import('../src/motion/runtime').PageSound[];
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

  it('plays the timelines a page hands over on the video\'s clock, exactly also after a jump: GSAP in seconds, anime.js in milliseconds, a Web Animation, a function', async () => {
    const win = page(
      '<div id="waapi"></div>',
      `// stand-ins with the methods the runtime calls: GSAP's (duration is a function) and anime.js' (a number)
       const gsap = { paused: false, time: -1, pause() { this.paused = true; }, duration: () => 5, totalTime(t) { this.time = t; } };
       const anime = { paused: false, time: -1, duration: 5000, pause() { this.paused = true; }, seek(ms) { this.time = ms; } };
       const waapi = document.getElementById('waapi').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, fill: 'forwards' });
       window.handed = { gsap: cuttle.timeline(gsap), anime: cuttle.timeline(anime, { at: 0.5 }), waapi: cuttle.timeline(waapi) };
       cuttle.timeline((t) => seen.push(t));`,
    );
    const handed = (win as unknown as { handed: { gsap: { paused: boolean; time: number }; anime: { paused: boolean; time: number }; waapi: Animation } }).handed;
    // set at once (the page's first frame may be drawn before any draw call)
    expect(handed.gsap).toMatchObject({ paused: true, time: 0 });
    await win.__cuttleDraw(1500);
    expect(handed.gsap.time).toBe(1.5);
    // from its start half a second in
    expect(handed.anime).toMatchObject({ paused: true, time: 1000 });
    // set by the timeline, not by when it first showed (it showed at 0)
    expect(handed.waapi.currentTime).toBe(1500);
    expect(win.getComputedStyle(win.document.getElementById('waapi')!).opacity).toBe('1');
    expect(win.seen).toEqual([0, 1.5]);
    expect(win.__cuttleErrors).toEqual([]);
  });

  it("sets HyperFrames' timelines (window.__timelines), the outermost only, and takes GSAP's lag smoothing off its ticker", async () => {
    const win = page(
      '',
      `const timeline = (name, parent) => ({ parent, pause() {}, duration: () => 4, totalTime(t) { seen.push([name, t]); } });
       const main = timeline('main');
       window.__timelines = { main, intro: timeline('intro', main), other: timeline('other') };
       window.gsap = { ticker: { lagSmoothing: (threshold) => seen.push(['lagSmoothing', threshold]) } };`,
    );
    await win.__cuttleDraw(2000);
    expect(win.seen).toEqual([['main', 2], ['other', 2], ['lagSmoothing', 0]]);
    await win.__cuttleDraw(2500);
    // the ticker is told once
    expect(win.seen.slice(3)).toEqual([['main', 2.5], ['other', 2.5]]);
  });

  it('says what it cannot play as a timeline', async () => {
    const win = page('', `cuttle.timeline({ play() {} });`);
    expect(win.__cuttleErrors).toEqual(['Error: cuttle.timeline takes a GSAP or anime.js timeline, a Web Animation, or a function of seconds']);
  });

  it('gives the page window.cuttle: its time, size, params and theme, and a draw call for every frame', async () => {
    const win = page('<div id="accent" style="color: var(--cuttle-accent)"></div>', `cuttle.onFrame((t) => seen.push(t));`);
    expect(win.cuttle).toMatchObject({ duration: 2, fps: 30, size: { width: 320, height: 180 }, format: '16:9', params: { title: 'Hi' } });
    expect(win.getComputedStyle(win.document.getElementById('accent')!).color).toBe('rgb(217, 119, 87)');
    await win.__cuttleDraw(0);
    await win.__cuttleDraw(1000 / 30);
    expect(win.seen).toEqual([0, 1 / 30]);
  });

  it('declares the kit\'s fonts before the page is parsed', () => {
    const win = page('', '');
    const faces = win.document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules]).filter((rule) => rule.constructor.name === 'CSSFontFaceRule');
    expect(faces.map((rule) => rule.cssText)).toEqual([expect.stringMatching(/font-family: Inter; font-weight: 700;.*inter-latin-700-normal\.woff2/)]);
  });

  it('gives the page the take: where a moment plays in the video, the pointer, and where a point of the screen is in this frame', async () => {
    const take: TakeData = {
      screen: { width: 2000, height: 1000 },
      events: [
        { t: 12, type: 'click', x: 500, y: 250, button: 'left' },
        { t: 12.5, type: 'keys', count: 3 },
      ],
      words: [{ t: 12.2, end: 12.6, text: 'Hello' }],
      markers: [{ t: 11, kind: 'prompt' }],
      zooms: [],
      masks: [],
      clips: [
        { start: 2, end: 6, from: 10, to: 14, speed: 1 },
        { start: 6, end: 11, from: 20, to: 40, speed: 4 },
      ],
      cursor: { fps: 10, start: 10, points: [0, 0, 10, 20, 20, 40] },
      window: { from: 11, to: 16 },
      recording: null,
    };
    const win = page('', '', { ...INIT, start: 3, take });
    const { take: api } = win.cuttle;
    expect(api.clicks).toEqual([take.events[0]]);
    expect([api.words, api.markers, api.window]).toEqual([take.words, take.markers, take.window]);
    expect([api.toOutput(12), api.toOutput(24), api.toOutput(15)]).toEqual([4, 7, null]);
    expect([api.toSource(5), api.toSource(8), api.toSource(1)]).toEqual([13, 28, null]);
    const between = api.cursorAt(10.05)!;
    expect([between.x, between.y].map((value) => Math.round(value * 1e6) / 1e6)).toEqual([5, 10]);
    expect([api.cursorAt(9), api.cursorAt(99)]).toEqual([{ x: 0, y: 0 }, { x: 20, y: 40 }]);
    // before a frame with a view (and in a scene) nothing of the screen is in the frame
    expect([api.toScreen(500, 250), api.cursor, api.source]).toEqual([null, null, null]);
    await win.__cuttleDraw(500, { source: 12.5, zoom: [0, 0, 1000, 500], content: [100, 50, 800, 400], cursor: { x: 500, y: 250 } });
    expect(win.cuttle.videoTime).toBe(3.5);
    expect(api.source).toBe(12.5);
    expect(api.toScreen(500, 250)).toEqual({ x: 500, y: 250, inside: true });
    expect(api.toScreen(1500, 250)).toEqual({ x: 1300, y: 250, inside: false });
    expect(api.cursor).toEqual({ x: 500, y: 250, inside: true });
  });

  it('hands the page frames of the recording from the take worker, and waits for a draw that awaits one', async () => {
    // a stand-in for the kit's worker: a frame `width` px wide whose red is a tenth of the second asked
    const worker = URL.createObjectURL(
      new Blob(
        [
          `let opened;
          self.onmessage = (event) => {
            const message = event.data;
            if (message.type === 'open') return void (opened = message);
            if (message.source < 0) return self.postMessage({ id: message.id, error: 'no frame at ' + message.source });
            const canvas = new OffscreenCanvas(message.width ?? opened.screen.width, 4);
            const g = canvas.getContext('2d');
            g.fillStyle = 'rgb(' + Math.round(message.source * 10) + ', 0, ' + opened.masks.length + ')';
            g.fillRect(0, 0, canvas.width, 4);
            const bitmap = canvas.transferToImageBitmap();
            self.postMessage({ id: message.id, bitmap }, [bitmap]);
          };`,
        ],
        { type: 'text/javascript' },
      ),
    );
    const take: TakeData = {
      screen: { width: 32, height: 18 },
      events: [],
      words: [],
      markers: [],
      zooms: [],
      masks: [{ from: 0, to: 9, rect: [0, 0, 4, 4], style: 'fill' }],
      clips: [],
      cursor: null,
      window: null,
      recording: 'cuttle-motion://project/takes/1/screen.mp4',
    };
    const win = page(
      '',
      `const marker = () => [...document.documentElement.children].find((element) => element.style.top === '180px')?.style.background ?? 'none';
       cuttle.onFrame(async (t) => {
         const bitmap = await cuttle.take.frame(10 + t, t > 1 ? { width: 8 } : undefined);
         const g = new OffscreenCanvas(1, 1).getContext('2d');
         g.drawImage(bitmap, 0, 0);
         seen.push({ t, width: bitmap.width, red: g.getImageData(0, 0, 1, 1).data[0], masks: g.getImageData(0, 0, 1, 1).data[2], marker: marker() });
       });`,
      { ...INIT, take, takeWorker: worker },
    );
    expect(await win.__cuttleDraw(500)).toBe(1);
    expect(await win.__cuttleDraw(1500)).toBe(2);
    // each draw answered once the frame was drawn, and the marker moved on only then
    expect(win.seen).toEqual([
      { t: 0.5, width: 32, red: 105, masks: 1, marker: 'none' },
      { t: 1.5, width: 8, red: 115, masks: 1, marker: 'rgb(1, 0, 200)' },
    ]);
    const marker = [...win.document.documentElement.children].find((element) => (element as HTMLElement).style.top === '180px') as HTMLElement;
    expect(marker.style.background).toBe('rgb(2, 0, 200)');
    // what the worker could not do, the page is told
    await expect(win.cuttle.take.frame(-1)).rejects.toThrow('no frame at -1');
    // without a recording there is nothing to read
    await expect(page('', '').cuttle.take.frame(1)).rejects.toThrow('no screen recording');
  });

  it('hands the page frames of a video of the project, from a reader of its own, without the take\'s masks', async () => {
    // a stand-in for the kit's worker: red a tenth of the second asked, green 100 for a.mp4 (200 for any other), blue its masks
    const worker = URL.createObjectURL(
      new Blob(
        [
          `let opened;
          self.onmessage = (event) => {
            const message = event.data;
            if (message.type === 'open') return void (opened = message);
            if (message.source > 5) return self.postMessage({ id: message.id, error: opened.name + ' has no frame at ' + message.source });
            const canvas = new OffscreenCanvas(message.width ?? 16, 4);
            const g = canvas.getContext('2d');
            g.fillStyle = 'rgb(' + Math.round(message.source * 10) + ', ' + (opened.url.endsWith('a.mp4') ? 100 : 200) + ', ' + opened.masks.length + ')';
            g.fillRect(0, 0, canvas.width, 4);
            const bitmap = canvas.transferToImageBitmap();
            self.postMessage({ id: message.id, bitmap }, [bitmap]);
          };`,
        ],
        { type: 'text/javascript' },
      ),
    );
    const take: TakeData = {
      screen: { width: 32, height: 18 },
      events: [],
      words: [],
      markers: [],
      zooms: [],
      masks: [{ from: 0, to: 9, rect: [0, 0, 4, 4], style: 'fill' }],
      clips: [],
      cursor: null,
      window: null,
      recording: 'cuttle-motion://project/takes/1/screen.mp4',
    };
    const win = page(
      '',
      `const a = cuttle.video('cuttle-motion://project/clips/a.mp4');
       const b = cuttle.video('cuttle-motion://project/clips/b.mp4');
       seen.push({ same: cuttle.video('cuttle-motion://project/clips/a.mp4') === a, src: a.src });
       const pixel = (bitmap) => { const g = new OffscreenCanvas(1, 1).getContext('2d'); g.drawImage(bitmap, 0, 0); return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
       cuttle.onFrame(async (t) => {
         const [first, second, recording] = await Promise.all([a.frame(t), b.frame(2 * t, { width: 8 }), cuttle.take.frame(t)]);
         seen.push({ t, a: pixel(first), b: [...pixel(second), second.width], take: pixel(recording) });
       });`,
      { ...INIT, take, takeWorker: worker },
    );
    expect(await win.__cuttleDraw(500)).toBe(1);
    expect(win.seen).toEqual([
      { same: true, src: 'cuttle-motion://project/clips/a.mp4' },
      { t: 0.5, a: [5, 100, 0], b: [10, 200, 0, 8], take: [5, 200, 1] },
    ]);
    // what a reader could not do, the page is told, with the video's name
    await expect(win.cuttle.video('cuttle-motion://project/clips/a.mp4').frame(6)).rejects.toThrow('cuttle-motion://project/clips/a.mp4 has no frame at 6');
    // without the kit's worker nothing is read
    await expect(page('', '').cuttle.video('clip.mp4').frame(1)).rejects.toThrow('the frames of clip.mp4 cannot be read here');
  });

  it('gives a transition page the frames it goes between before it draws, and how far it is', async () => {
    // two raw frames at the page's size: red and blue
    const raw = (rgb: number[]) => {
      const data = new Uint8Array(INIT.width * INIT.height * 4);
      for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
      return URL.createObjectURL(new Blob([data]));
    };
    const win = page(
      '',
      `cuttle.onFrame((t) => {
         const g = new OffscreenCanvas(1, 1).getContext('2d');
         const colour = (bitmap) => (g.drawImage(bitmap, 0, 0), [...g.getImageData(0, 0, 1, 1).data].slice(0, 3));
         seen.push({ t, progress: cuttle.progress, from: cuttle.from && [cuttle.from.width, cuttle.from.height, ...colour(cuttle.from)], to: cuttle.to && colour(cuttle.to) });
       });`,
      { ...INIT, transition: true },
    );
    expect([win.cuttle.from, win.cuttle.to, win.cuttle.progress]).toEqual([null, null, 0]);
    await win.__cuttleDraw(500, null, { from: raw([255, 0, 0]), to: raw([0, 0, 255]) });
    await win.__cuttleDraw(1500, null, { from: raw([0, 255, 0]), to: raw([0, 0, 255]) });
    expect(win.seen).toEqual([
      { t: 0.5, progress: 0.25, from: [320, 180, 255, 0, 0], to: [0, 0, 255] },
      { t: 1.5, progress: 0.75, from: [320, 180, 0, 255, 0], to: [0, 0, 255] },
    ]);
    // a frame that cannot be read fails the draw
    await expect(win.__cuttleDraw(1600, null, { from: 'blob:nothing', to: raw([0, 0, 0]) })).rejects.toThrow();
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

  it('gathers the sounds the page asks for: into the item or at a second of the video, once each, at a level from 0 to 1', async () => {
    const win = page(
      '',
      `cuttle.sound('whoosh', { at: 0.3, volume: 0.7 });
       cuttle.sound('whoosh', { at: 0.3, volume: 0.7 });
       cuttle.sound('pop', { videoTime: 12.5, volume: 3 });
       cuttle.sound('sounds/ding.wav');
       cuttle.sound('');
       setTimeout(() => cuttle.sound('tick', { volume: -1 }), 400);`,
      { ...INIT, start: 10 },
    );
    expect(win.__cuttleSounds).toEqual([
      { sound: 'whoosh', at: 0.3, volume: 0.7 },
      { sound: 'pop', video: 12.5, volume: 1 },
      { sound: 'sounds/ding.wav', at: 0, volume: 0.8 },
    ]);
    expect(win.__cuttleErrors).toEqual(['Error: cuttle.sound needs the name of a sound']);
    // without a moment: the moment it is asked, in the item's seconds
    await win.__cuttleDraw(500);
    expect(win.__cuttleSounds.at(-1)).toEqual({ sound: 'tick', at: 0.4, volume: 0 });
  });
});

/// <reference lib="dom" />
// The page side of a motion item: run in the page before its own scripts (the renderer injects
// this function's source with its argument), so it must not use anything from outside itself.
//
// It gives the page a virtual clock: performance.now, Date, timers, requestAnimationFrame and every
// CSS animation, transition and Web Animation follow the frame being drawn, never the wall clock.
// `__cuttleDraw` moves it to a frame's time and answers once the browser has drawn the page as it
// is then; a marker pixel below the page names the frame, so the renderer knows which paint shows
// it. And it gives the page `window.cuttle`: its time, size, params, theme and a seeded random.

/** What the renderer tells the page. */
export interface MotionInit {
  /** Seconds the item lasts. */
  duration: number;
  fps: number;
  width: number;
  height: number;
  /** `16:9`, `9:16`, `1:1` or the output's own size. */
  format: string;
  params: Record<string, unknown>;
  /** CSS variables set on the page's root (`--cuttle-accent`…). */
  theme: Record<string, string>;
  /** Seeds `Math.random`, so the item looks the same in every render. */
  seed: number;
}

/** The page's `window.cuttle`. */
export interface CuttleApi {
  /** Seconds into this item. */
  readonly time: number;
  readonly duration: number;
  readonly fps: number;
  readonly size: { width: number; height: number };
  readonly format: string;
  readonly params: Record<string, unknown>;
  readonly theme: Record<string, string>;
  /** Calls `draw(seconds)` for every frame, before it is drawn (also after a seek): the surest way to animate. */
  onFrame(draw: (seconds: number) => void): void;
  /** Holds the first frame until `promise` settles (fonts, images, models). */
  ready(promise: Promise<unknown>): void;
}

export function motionRuntime(init: MotionInit): void {
  type Timer = { at: number; fn: unknown; args: unknown[]; every?: number };
  const page = window as unknown as Record<string, unknown>;
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, Timer>();
  const frames = new Map<number, FrameRequestCallback>();
  const drawers: ((seconds: number) => void)[] = [];
  const holds: Promise<unknown>[] = [];
  const errors: string[] = [];
  page.__cuttleErrors = errors;
  const note = (error: unknown) => errors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  window.addEventListener('error', (event) => note(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => note(event.reason));

  // the browser's own frames: an advance answers once one has drawn the change
  const realFrame = window.requestAnimationFrame.bind(window);

  // a seeded random (mulberry32)
  let seed = init.seed >>> 0;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // time
  const RealDate = Date;
  const base = RealDate.UTC(2026, 0, 1);
  performance.now = () => now;
  class VirtualDate extends RealDate {
    constructor(...args: [] | ConstructorParameters<DateConstructor>) {
      if (args.length === 0) super(base + now);
      else super(...(args as [number]));
    }
    static override now(): number {
      return base + now;
    }
  }
  page.Date = VirtualDate;
  page.setTimeout = (fn: unknown, ms = 0, ...args: unknown[]) => {
    const id = nextId++;
    // at least 1 ms, as browsers clamp: a timeout that sets itself again cannot stall a frame
    timers.set(id, { at: now + Math.max(1, Number(ms) || 0), fn, args });
    return id;
  };
  page.setInterval = (fn: unknown, ms = 0, ...args: unknown[]) => {
    const id = nextId++;
    const every = Math.max(1, Number(ms) || 0);
    timers.set(id, { at: now + every, fn, args, every });
    return id;
  };
  page.clearTimeout = page.clearInterval = (id: number) => timers.delete(id);
  page.requestAnimationFrame = (fn: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, fn);
    return id;
  };
  page.cancelAnimationFrame = (id: number) => frames.delete(id);

  /** Each animation's start on the clock: when it was first seen (CSS starts them as styles apply). */
  const started = new WeakMap<Animation, number>();
  const sight = () => {
    for (const animation of document.getAnimations()) if (!started.has(animation)) started.set(animation, now);
  };
  const call = (fn: unknown, args: unknown[]) => {
    try {
      if (typeof fn === 'function') fn(...args);
    } catch (error) {
      note(error);
    }
    sight();
  };

  // the theme, as CSS variables on the root (a constructed sheet works before the page is parsed)
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`:root { ${Object.entries(init.theme).map(([name, value]) => `${name}: ${value};`).join(' ')} }`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  const api: CuttleApi = {
    get time() {
      return now / 1000;
    },
    duration: init.duration,
    fps: init.fps,
    size: { width: init.width, height: init.height },
    format: init.format,
    params: init.params,
    theme: init.theme,
    onFrame: (draw) => void drawers.push(draw),
    ready: (promise) => void holds.push(Promise.resolve(promise).catch(note)),
  };
  page.cuttle = api;

  /** The frame marker: a 2×2 px element just below the page; its colour is the frame's number. */
  let marker: HTMLElement | undefined;
  const mark = (frame: number) => {
    if (!marker) {
      marker = document.createElement('div');
      marker.style.cssText = `position:fixed;left:0;top:${init.height}px;width:2px;height:2px;margin:0;padding:0;border:0;z-index:2147483647;pointer-events:none;background:#000`;
      document.documentElement.appendChild(marker);
    }
    marker.style.background = `rgb(${frame & 255}, ${(frame >> 8) & 255}, 200)`;
  };

  /** Once the page has loaded: its fonts, its images and what it asked to wait for. */
  page.__cuttleReady = async () => {
    await document.fonts.ready;
    const images = Array.from(document.images).filter((image) => !image.complete);
    await Promise.all(
      images.map(
        (image) =>
          new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          }),
      ),
    );
    await Promise.all(holds);
  };

  let frame = 0;
  /**
   * Moves the clock to `ms` (never back) and draws: due timers in order, one animation frame, every
   * animation to its time. Answers with the draw's number, which the marker shows.
   */
  page.__cuttleDraw = (ms: number): Promise<number> => {
    mark(++frame);
    sight();
    const target = Math.max(now, ms);
    for (let fired = 0; ; fired++) {
      if (fired === 100_000) {
        note(new Error('the page set more than 100000 timers in one frame'));
        break;
      }
      let due: [number, Timer] | undefined;
      for (const entry of timers) if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry;
      if (!due) break;
      const [id, timer] = due;
      now = timer.at;
      if (timer.every) timer.at += timer.every;
      else timers.delete(id);
      call(timer.fn, timer.args);
    }
    now = target;
    for (const draw of drawers) call(draw, [now / 1000]);
    const callbacks = [...frames.values()];
    frames.clear();
    for (const fn of callbacks) call(fn, [now]);
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = (now - (started.get(animation) ?? now)) * (animation.playbackRate || 1);
    }
    return new Promise((resolve) => realFrame(() => realFrame(() => resolve(frame))));
  };
}

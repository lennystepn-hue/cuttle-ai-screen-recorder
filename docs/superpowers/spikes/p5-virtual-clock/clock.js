// The virtual clock, run in the page before its own scripts: time stands still until the renderer
// advances it. Timers, requestAnimationFrame, performance.now, Date and every CSS animation,
// transition and Web Animation follow it.
(() => {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const frames = new Map();
  const RealDate = Date;
  const base = RealDate.now();
  // the browser's own frames: the renderer waits on them until a change is drawn
  const realFrame = window.requestAnimationFrame.bind(window);
  performance.now = () => now;
  class VirtualDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(base + now);
      else super(...args);
    }
    static now() {
      return base + now;
    }
  }
  window.Date = VirtualDate;
  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = nextId++;
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args });
    return id;
  };
  window.setInterval = (fn, ms = 0, ...args) => {
    const id = nextId++;
    const every = Math.max(1, Number(ms) || 0);
    timers.set(id, { at: now + every, fn, args, every });
    return id;
  };
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  window.requestAnimationFrame = (fn) => {
    const id = nextId++;
    frames.set(id, fn);
    return id;
  };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  /** Each animation's start on the virtual clock: when it was first seen. */
  const started = new WeakMap();
  const sight = () => {
    for (const animation of document.getAnimations()) if (!started.has(animation)) started.set(animation, now);
  };
  const call = (fn, args) => {
    try {
      typeof fn === 'function' ? fn(...args) : new Function(String(fn))();
    } catch (error) {
      console.error(error);
    }
    sight();
  };
  /**
   * The frame marker: one pixel in a row below the page (the window is one row taller; the renderer
   * crops it). Its colour is the frame's number, so the renderer knows a paint shows this frame.
   */
  let marker;
  const mark = (frame) => {
    if (!marker) {
      marker = document.createElement('div');
      marker.style.cssText = 'position:fixed;left:0;top:360px;width:2px;height:2px;z-index:2147483647;pointer-events:none';
      document.documentElement.appendChild(marker);
    }
    marker.style.background = `rgb(${frame & 255}, ${(frame >> 8) & 255}, 200)`;
  };
  window.__cuttleFrame = 0;
  /** Moves the clock on by `ms`: due timers in order, one animation frame, every animation to its time. */
  window.__cuttleAdvance = (ms) => {
    mark(++window.__cuttleFrame);
    sight();
    const target = now + ms;
    for (;;) {
      let due;
      for (const [id, timer] of timers) if (timer.at <= target && (!due || timer.at < due[1].at)) due = [id, timer];
      if (!due) break;
      const [id, timer] = due;
      now = timer.at;
      if (timer.every) timer.at += timer.every;
      else timers.delete(id);
      call(timer.fn, timer.args);
    }
    now = target;
    const callbacks = [...frames.values()];
    frames.clear();
    for (const fn of callbacks) call(fn, [now]);
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = (now - started.get(animation)) * (animation.playbackRate || 1);
    }
    // answered once the browser has drawn the page as it is now
    return new Promise((resolve) => realFrame(() => realFrame(() => resolve(now))));
  };
})();

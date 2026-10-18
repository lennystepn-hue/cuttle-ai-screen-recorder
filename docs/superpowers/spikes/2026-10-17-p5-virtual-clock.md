# P5 spike: HTML rendered frame by frame on a virtual clock (2026-10-17)

Question: can Cuttle render any HTML page (CSS animations and transitions, Web Animations,
requestAnimationFrame loops, canvas, timers) deterministically, frame by frame, with alpha, fast
enough, in Electron 44 on Windows, never showing a window?

Answer: yes, with an injected clock and paint events from an offscreen window.

## What works

- **The window:** `BrowserWindow({ show: false, transparent: true, frame: false, backgroundColor: '#00000000', webPreferences: { offscreen: true, sandbox: true } })`, then `setFrameRate(240)`.
- **CDP needs a page first:** `debugger.attach` works at once, but every command hangs until the window has loaded something. Load `about:blank` first, then `Page.enable` and `Page.addScriptToEvaluateOnNewDocument(clock)`, then the page.
- **The clock** (`p5-virtual-clock/clock.js`, run by `p5-virtual-clock/render.cjs`), run in the main world before the page's scripts:
  - It replaces `performance.now`, `Date` (`now()` and `new Date()`), `setTimeout`/`setInterval` and `requestAnimationFrame`/`cancelAnimationFrame`.
  - `__cuttleAdvance(ms)` fires the due timers in order, then one animation frame, then sets every animation from `document.getAnimations()` (paused) to `currentTime = now − first seen`. That covers CSS animations, CSS transitions (started from a timer: first seen then) and WAAPI.
  - It answers after two real browser frames (`requestAnimationFrame` kept from before the override), so the change is committed.
- **The frame:** the window's `paint` events. Ignore empty images: every `invalidate()` answers at once with an empty paint, and a loop on them starves the compositor (200 000 paints a frame). After the advance, invalidate once and take the next paint whose marker pixel shows the frame.
  - The marker is a 2×2 px element at y = 360 below the page. The window is taller than the page (Electron makes 362 → 365), and the renderer crops it off.
  - Its colour encodes the frame number. In the bitmap it reads as BGRA: B = 200, G = frame >> 8, R = frame & 255.
- **Alpha:** the bitmap carries the page's alpha. A transparent background is 0, the card's rgba(…, 0.9) is 230.

## Numbers (640×360, Windows, software GL)

| Offscreen rate | Per frame | 30 fps output |
|---|---|---|
| 60 Hz | 33.75 ms | about real time |
| 240 Hz | 11.75 ms | 2.8× real time |

Frame 40 is byte-identical at 60 and 240 Hz: deterministic.

## What failed

- `Emulation.setVirtualTimePolicy` (Chrome's virtual time) never returns in a non-headless offscreen window, before or after the load.
- `capturePage()` after an `invalidate()` gave frames one step behind.
- Without the real-frame wait, the paint showed the previous frame's state (the marker proved it).

## Left for the spec

- Fonts and images: `cuttle.ready()` before frame 0 (`document.fonts.ready`, image decode).
- `<video>` elements: seek per frame (`currentTime`, wait for `seeked`).
- Lottie, GSAP and Three.js: GSAP and Lottie run on rAF and `performance.now` (covered). Three.js renders in rAF (covered); WebGL in an offscreen window needs GPU or SwiftShader (check).
- The page's own `Date` in `Intl` and the like: fine.
- Pages that never settle (an infinite loop in a timer) need a time limit per frame.

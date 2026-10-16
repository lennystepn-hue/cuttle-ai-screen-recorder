import type { Size } from '../src/layout';

/** Size of the fake screen recording every scenario uses (16:10, like a laptop). */
export const SCREEN: Size = { width: 1280, height: 800 };

function canvas2d(width: number, height: number): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
  const canvas = new OffscreenCanvas(width, height);
  return [canvas, canvas.getContext('2d')!];
}

/** An editor-like screen made of axis-aligned rects only, so it rasterizes the same everywhere. */
export function fakeScreen(): OffscreenCanvas {
  const [canvas, g] = canvas2d(SCREEN.width, SCREEN.height);
  g.fillStyle = '#1E1E1E';
  g.fillRect(0, 0, 1280, 800);
  g.fillStyle = '#252526';
  g.fillRect(0, 0, 240, 800);
  g.fillStyle = '#333333';
  g.fillRect(0, 0, 1280, 36);
  g.fillStyle = '#007ACC';
  g.fillRect(0, 776, 1280, 24);
  const colors = ['#569CD6', '#CE9178', '#6A9955', '#DCDCAA', '#C586C0', '#9CDCFE'];
  for (let line = 0; line < 30; line++) {
    let x = 280 + (line % 4) * 32;
    for (let word = 0; word < 4; word++) {
      const width = 30 + ((line * 7 + word * 13) % 9) * 18;
      g.fillStyle = colors[(line + word) % colors.length]!;
      g.fillRect(x, 60 + line * 23, width, 12);
      x += width + 12;
    }
  }
  g.fillStyle = '#C5C5C5';
  for (let item = 0; item < 14; item++) g.fillRect(24, 60 + item * 26, 90 + ((item * 37) % 100), 10);
  g.fillStyle = '#F2F2F2';
  g.fillRect(900, 520, 340, 200);
  g.fillStyle = '#D97757';
  g.fillRect(930, 560, 120, 36);
  g.fillStyle = '#3F3F46';
  for (let row = 0; row < 4; row++) g.fillRect(930, 620 + row * 22, 260 - row * 40, 10);
  return canvas;
}

/** A 4:3 camera frame: backdrop, a head and shoulders, a marker in the top-left corner. */
export function fakeWebcam(): OffscreenCanvas {
  const [canvas, g] = canvas2d(640, 480);
  g.fillStyle = '#3B4A5A';
  g.fillRect(0, 0, 640, 480);
  g.fillStyle = '#FF3366';
  g.fillRect(0, 0, 160, 40);
  g.fillStyle = '#2F6F8F';
  g.beginPath();
  g.ellipse(320, 470, 190, 120, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#E0B48C';
  g.beginPath();
  g.arc(320, 230, 105, 0, Math.PI * 2);
  g.fill();
  return canvas;
}

/** A tall web page for still scenes: dark header, coloured hero, rows of cards, dark footer. */
export function fakePage(): OffscreenCanvas {
  const [canvas, g] = canvas2d(1280, 2400);
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, 1280, 2400);
  g.fillStyle = '#111827';
  g.fillRect(0, 0, 1280, 72);
  g.fillStyle = '#6366F1';
  g.fillRect(80, 120, 1120, 400);
  g.fillStyle = '#FFFFFF';
  g.fillRect(140, 240, 600, 48);
  g.fillRect(140, 310, 420, 24);
  const cards = ['#F3F4F6', '#E0E7FF', '#FCE7F3', '#DCFCE7'];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      g.fillStyle = cards[(row + col) % cards.length]!;
      g.fillRect(80 + col * 380, 600 + row * 420, 340, 360);
    }
  }
  g.fillStyle = '#111827';
  g.fillRect(0, 2280, 1280, 120);
  return canvas;
}

/** A 16:9 image for the `image` background preset. */
export function fakeBackground(): OffscreenCanvas {
  const [canvas, g] = canvas2d(960, 540);
  const quadrants = ['#264653', '#2A9D8F', '#E9C46A', '#E76F51'];
  quadrants.forEach((color, i) => {
    g.fillStyle = color;
    g.fillRect((i % 2) * 480, Math.floor(i / 2) * 270, 480, 270);
  });
  g.fillStyle = '#FFFFFF';
  for (let i = 0; i < 8; i++) g.fillRect(60 + i * 110, 60 + i * 52, 60, 30);
  return canvas;
}

export interface Fixtures {
  screen: OffscreenCanvas;
  webcam: OffscreenCanvas;
  page: ImageBitmap;
  background: ImageBitmap;
}

let cached: Promise<Fixtures> | undefined;

/** The fake sources, created once per page. */
export function fixtures(): Promise<Fixtures> {
  cached ??= (async () => ({
    screen: fakeScreen(),
    webcam: fakeWebcam(),
    page: await createImageBitmap(fakePage(), { premultiplyAlpha: 'premultiply' }),
    background: await createImageBitmap(fakeBackground(), { premultiplyAlpha: 'premultiply' }),
  }))();
  return cached;
}

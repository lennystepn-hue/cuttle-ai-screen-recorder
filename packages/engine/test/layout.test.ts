import { describe, expect, it } from 'vitest';
import { parseProject } from '@cuttle/project';
import { createTimeline } from '@cuttle/timeline';
import {
  cursorSizePx,
  maskRectToOutput,
  placeBadge,
  placeOverlay,
  sourceRectToOutput,
  sourceToOutput,
  stillCrop,
  unitFor,
  uvRect,
  watermarkRect,
  webcamRect,
  windowLayout,
} from '../src/layout';
import { clipView } from '../src/view';

const HD = { width: 1920, height: 1080 };

describe('unitFor', () => {
  it('is 1 at 1080 px on the short side', () => {
    expect(unitFor(HD)).toBe(1);
    expect(unitFor({ width: 1080, height: 1920 })).toBe(1);
    expect(unitFor({ width: 640, height: 360 })).toBeCloseTo(1 / 3);
  });
});

describe('windowLayout', () => {
  it('fits a 16:9 screen with a 36-unit title bar into 1080p, padded and centred', () => {
    const layout = windowLayout(HD, 16 / 9, { titleBar: 36, radius: 14 });
    // height-limited: 1080 - 2*64 - 36 = 916 rows of content, 916 * 16/9 = 1628.4 columns
    expect(layout.content).toEqual([146, 100, 1628, 916]);
    expect(layout.window).toEqual([146, 64, 1628, 952]);
    expect(layout.titleBar).toBe(36);
    expect(layout.radius).toBe(14);
  });

  it('is width-limited for a tall output', () => {
    const layout = windowLayout({ width: 1080, height: 1920 }, 16 / 10, { titleBar: 36, radius: 14 });
    expect(layout.content[2]).toBe(952); // 1080 - 2*64
    expect(layout.content[3]).toBe(595); // 952 / 1.6
    expect(layout.window[1]).toBe(Math.round((1920 - 595 - 36) / 2));
  });

  it('scales padding, title bar and radius with the output size', () => {
    const layout = windowLayout({ width: 640, height: 360 }, 16 / 10, { titleBar: 36, radius: 15 });
    expect(layout.titleBar).toBe(12);
    expect(layout.radius).toBeCloseTo(5);
    expect(layout.content[3]).toBe(Math.round(360 - (2 * 64) / 3 - 12));
  });

  it('fills the output without chrome', () => {
    const layout = windowLayout(HD, 16 / 10, null);
    expect(layout.content).toEqual([96, 0, 1728, 1080]);
    expect(layout.window).toEqual(layout.content);
    expect(layout.radius).toBe(0);
    expect(layout.titleBar).toBe(0);
  });

  it('caps the radius at half the window size', () => {
    expect(windowLayout({ width: 200, height: 200 }, 1, { titleBar: 0, radius: 900 }).radius).toBeLessThanOrEqual(100);
  });
});

describe('windowLayout for a device', () => {
  const phone = { titleBar: 0, radius: 14, device: { bezel: 0.045, radius: 0.155 } };

  it('fits a phone screen and its bezel, a share of its width, into the padded output', () => {
    const layout = windowLayout(HD, 9 / 19.5, phone);
    const [x, y, w, h] = layout.content;
    // height-limited: 1080 - 2*64 = 952 rows for the screen and two bezels of 4.5 % of its width
    expect(h + 2 * Math.round(0.045 * w)).toBeLessThanOrEqual(952);
    expect(h).toBeGreaterThan(900);
    expect(w / h).toBeCloseTo(9 / 19.5, 2);
    const band = Math.round(0.045 * w);
    expect(layout.window).toEqual([x - band, y - band, w + 2 * band, h + 2 * band]);
    expect(layout.titleBar).toBe(0);
    expect(layout.radius).toBeCloseTo(0.155 * layout.window[2], 6);
    // the screen is clipped inside the bezel, its corners the body's less the bezel
    expect(layout.clip).toEqual(layout.content);
    expect(layout.clipRadius).toBeCloseTo(layout.radius - band, 6);
    // centred
    expect(Math.abs(x + w / 2 - HD.width / 2)).toBeLessThanOrEqual(1);
  });

  it('clips a window to the window, title bar and all, as before', () => {
    const layout = windowLayout(HD, 16 / 9, { titleBar: 36, radius: 14 });
    expect(layout.clip).toEqual(layout.window);
    expect(layout.clipRadius).toBe(layout.radius);
  });
});

describe('watermarkRect', () => {
  it('sits in its corner, a margin from the edges, as high as its share of the short side', () => {
    expect(watermarkRect(HD, { corner: 'bottom-right', size: 0.1 }, 2)).toEqual([1920 - 40 - 216, 1080 - 40 - 108, 216, 108]);
    expect(watermarkRect(HD, { corner: 'top-left', size: 0.05 }, 1)).toEqual([40, 40, 54, 54]);
  });

  it('moves past the webcam bubble in the same corner: above it at the bottom, below it at the top', () => {
    const bubble = webcamRect(HD, { corner: 'bottom-right', size: 0.18 });
    const [, y, , h] = watermarkRect(HD, { corner: 'bottom-right', size: 0.06 }, 3, bubble);
    expect(y + h).toBeLessThanOrEqual(bubble[1]);
    const top = webcamRect(HD, { corner: 'top-left', size: 0.18 });
    expect(watermarkRect(HD, { corner: 'top-left', size: 0.06 }, 3, top)[1]).toBeGreaterThanOrEqual(top[1] + top[3]);
    // in another corner it stays
    expect(watermarkRect(HD, { corner: 'top-right', size: 0.06 }, 3, bubble)[1]).toBe(40);
  });
});

describe('source to output mapping', () => {
  const content: [number, number, number, number] = [100, 50, 800, 500];

  it('maps the full screen onto the content rect', () => {
    const full: [number, number, number, number] = [0, 0, 1600, 1000];
    expect(sourceToOutput(0, 0, full, content)).toEqual([100, 50]);
    expect(sourceToOutput(1600, 1000, full, content)).toEqual([900, 550]);
    expect(sourceRectToOutput([400, 250, 800, 500], full, content)).toEqual([300, 175, 400, 250]);
  });

  it('follows the zoom crop', () => {
    const zoom: [number, number, number, number] = [800, 500, 800, 500]; // bottom-right quarter, 2x
    expect(sourceToOutput(800, 500, zoom, content)).toEqual([100, 50]);
    expect(sourceToOutput(1200, 750, zoom, content)).toEqual([500, 300]);
    expect(sourceRectToOutput([800, 500, 100, 50], zoom, content)).toEqual([100, 50, 100, 50]);
  });

  it('grows mask rects to whole pixels plus one', () => {
    const full: [number, number, number, number] = [0, 0, 1600, 1000];
    expect(maskRectToOutput([400, 250, 800, 500], full, content)).toEqual([299, 174, 402, 252]);
    expect(maskRectToOutput([401, 251, 3, 3], full, content)).toEqual([299, 174, 4, 4]); // 300.5..302 → 299..303
  });

  it('grows mask rects by the filter spread of a texel under strong magnification', () => {
    const zoom: [number, number, number, number] = [0, 0, 100, 100];
    const square: [number, number, number, number] = [0, 0, 800, 800]; // 8 output px per source px
    // 80..160 output px, plus half a texel (4 px) of bilinear spread, of which the extra pixel covers 1.5
    expect(maskRectToOutput([10, 10, 10, 10], zoom, square)).toEqual([76, 76, 88, 88]);
    // fractional edges hide every texel they touch
    expect(maskRectToOutput([10.5, 10.2, 9, 9.5], zoom, square)).toEqual([76, 76, 88, 88]);
  });

  it('keeps a mask over what it hides at every frame of a zoom that comes in, moves and leaves', () => {
    // an address on the right of a 2560 × 1440 screen, masked; a 2× zoom on it that moves down to it
    const text: [number, number, number, number] = [1900, 900, 300, 30];
    const parsed = parseProject({
      version: 1,
      sources: { screen: 's.mp4' },
      scenes: [{ type: 'clip', from: 0, to: 10 }],
      zooms: [{ at: 2, duration: 5, rect: [1280, 0, 1280, 720], moves: [{ at: 4, rect: [1280, 720, 1280, 720] }] }],
      masks: [{ from: 0, to: 10, rect: text }],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const timeline = createTimeline(parsed.project, { screenSize: { width: 2560, height: 1440 } });
    const layout = windowLayout(HD, 16 / 9, { titleBar: 36, radius: 14 });
    for (let frame = 0; frame <= 300; frame++) {
      const [layer] = timeline.frameAt(frame / 30).layers;
      const zoom = layer!.zoom!;
      // the mask is the same rect of the screen, mapped by the very zoom the screen is drawn with
      expect(layer!.masks.map((mask) => mask.rect)).toEqual([text]);
      const [mx, my, mw, mh] = maskRectToOutput(layer!.masks[0]!.rect, zoom, layout.content);
      const [tx, ty, tw, th] = sourceRectToOutput(text, zoom, layout.content);
      expect(mx <= tx && my <= ty && mx + mw >= tx + tw && my + mh >= ty + th, `frame ${frame}`).toBe(true);
    }
  });

  it('turns image px into texture coordinates', () => {
    expect(uvRect([0, 0, 1600, 1000], { width: 1600, height: 1000 })).toEqual([0, 0, 1, 1]);
    expect(uvRect([400, 250, 800, 500], { width: 1600, height: 1000 })).toEqual([0.25, 0.25, 0.5, 0.5]);
  });
});

describe('cursorSizePx', () => {
  it('is 32 source px on a 1080-row screen, scaled like the content', () => {
    expect(cursorSizePx({ width: 1920, height: 1080 }, 1, [0, 0, 1920, 1080], [0, 0, 1920, 1080])).toBe(32);
    expect(cursorSizePx({ width: 1920, height: 1080 }, 1, [0, 0, 1920, 1080], [0, 0, 960, 540])).toBe(16);
  });

  it('grows with the zoom, the size setting and the screen height', () => {
    expect(cursorSizePx({ width: 1920, height: 1080 }, 1, [0, 0, 960, 540], [0, 0, 1920, 1080])).toBe(64);
    expect(cursorSizePx({ width: 1920, height: 1080 }, 1.5, [0, 0, 1920, 1080], [0, 0, 1920, 1080])).toBe(48);
    expect(cursorSizePx({ width: 2560, height: 1440 }, 1, [0, 0, 2560, 1440], [0, 0, 2560, 1440])).toBeCloseTo(42.67, 2);
  });
});

describe('webcamRect', () => {
  it('puts a square of size * short side into the chosen corner, 40 units from the edges', () => {
    expect(webcamRect(HD, { corner: 'bottom-left', size: 0.2 })).toEqual([40, 1080 - 40 - 216, 216, 216]);
    expect(webcamRect(HD, { corner: 'top-right', size: 0.2 })).toEqual([1920 - 40 - 216, 40, 216, 216]);
    expect(webcamRect(HD, { corner: 'top-left', size: 0.2 })).toEqual([40, 40, 216, 216]);
    expect(webcamRect(HD, { corner: 'bottom-right', size: 0.2 })).toEqual([1920 - 40 - 216, 1080 - 40 - 216, 216, 216]);
  });

  it('puts the bubble where its position says, its centre at that share of the video, kept inside it', () => {
    // a 216 px bubble centred at 62 % across and 30 % down
    expect(webcamRect(HD, { corner: 'bottom-left', size: 0.2, position: { x: 0.62, y: 0.3 } })).toEqual([1082, 216, 216, 216]);
    // at the very edge it stays whole on the video
    expect(webcamRect(HD, { corner: 'bottom-left', size: 0.2, position: { x: 1, y: 0 } })).toEqual([1920 - 216, 0, 216, 216]);
    // a share keeps its place in another format: the same spot of a 9:16 video
    expect(webcamRect({ width: 1080, height: 1920 }, { corner: 'bottom-left', size: 0.2, position: { x: 0.5, y: 0.5 } })).toEqual([432, 852, 216, 216]);
  });
});

describe('placeOverlay and placeBadge', () => {
  const sprite = { width: 300, height: 60 };

  it('centres a text horizontally at the top, centre or bottom, 56 units from the edge', () => {
    expect(placeOverlay(HD, sprite, 'top', 'center')).toEqual([810, 56, 300, 60]);
    expect(placeOverlay(HD, sprite, 'center', 'center')).toEqual([810, 510, 300, 60]);
    expect(placeOverlay(HD, sprite, 'bottom', 'center')).toEqual([810, 1080 - 56 - 60, 300, 60]);
  });

  it('left-aligns when asked', () => {
    expect(placeOverlay(HD, sprite, 'bottom', 'left')).toEqual([56, 964, 300, 60]);
  });

  it('puts the badge into the content top-right corner', () => {
    expect(placeBadge([100, 50, 800, 500], { width: 120, height: 40 }, 1)).toEqual([100 + 800 - 16 - 120, 66, 120, 40]);
  });

  it('moves a top or bottom text clear of the webcam bubble, half a margin away', () => {
    const bottomLeft = webcamRect(HD, { corner: 'bottom-left', size: 0.18 }); // the default bubble: [40, 846, 194, 194]
    expect(placeOverlay(HD, sprite, 'bottom', 'left', [bottomLeft])).toEqual([56, 846 - 28 - 60, 300, 60]);
    expect(placeOverlay(HD, sprite, 'bottom', 'center', [bottomLeft])).toEqual([810, 964, 300, 60]); // not in the way
    expect(placeOverlay(HD, sprite, 'top', 'left', [webcamRect(HD, { corner: 'top-left', size: 0.18 })])).toEqual([56, 40 + 194 + 28, 300, 60]);
    expect(placeOverlay(HD, sprite, 'center', 'left', [webcamRect(HD, { corner: 'top-left', size: 0.5 })])).toEqual([56, 510, 300, 60]); // centre stays
  });

  it('moves a text past every obstacle in its way, nearest to its edge first', () => {
    const square = { width: 1080, height: 1080 };
    const bubble = webcamRect(square, { corner: 'top-right', size: 0.22 }); // [802, 40, 238, 238]
    const badge = placeBadge([64, 290, 952, 536], { width: 108, height: 37 }, 1, bubble); // stays at [892, 306, 108, 37]
    // a wide top pill dodges the bubble to y = 306, where the badge is, so it moves on below the badge
    expect(placeOverlay(square, { width: 800, height: 60 }, 'top', 'center', [badge, bubble])).toEqual([140, 306 + 37 + 28, 800, 60]);
  });

  it('moves the badge left of a webcam bubble in its corner, or below it when there is no room', () => {
    const topRight = webcamRect(HD, { corner: 'top-right', size: 0.18 }); // [1686, 40, 194, 194]
    expect(placeBadge([146, 100, 1628, 916], { width: 108, height: 37 }, 1, topRight)).toEqual([1686 - 16 - 108, 116, 108, 37]);
    expect(placeBadge([146, 100, 1628, 916], { width: 108, height: 37 }, 1, webcamRect(HD, { corner: 'bottom-right', size: 0.18 }))).toEqual([
      1650, 116, 108, 37,
    ]);
    // 1:1 without a frame, a big bubble and a long custom badge: left of the bubble would leave the content
    const square = { width: 1080, height: 1080 };
    const big = webcamRect(square, { corner: 'top-right', size: 0.5 }); // [500, 40, 540, 540]
    expect(placeBadge([0, 236, 1080, 608], { width: 540, height: 37 }, 1, big)).toEqual([524, 40 + 540 + 16, 540, 37]);
  });

  it('never moves a text or the badge out of the output or onto the bubble, in any format, corner and size', () => {
    const inside = (rect: number[], area: { width: number; height: number }) =>
      rect[0]! >= 0 && rect[1]! >= 0 && rect[0]! + rect[2]! <= area.width && rect[1]! + rect[3]! <= area.height;
    const overlap = (a: number[], b: number[]) => a[0]! < b[0]! + b[2]! && b[0]! < a[0]! + a[2]! && a[1]! < b[1]! + b[3]! && b[1]! < a[1]! + a[3]!;
    for (const output of [HD, { width: 1080, height: 1080 }, { width: 1080, height: 1920 }]) {
      const unit = unitFor(output);
      const { content } = windowLayout(output, 16 / 9, { titleBar: 36, radius: 14 });
      for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
        for (const size of [0.18, 0.35, 0.5]) {
          const bubble = webcamRect(output, { corner: corner, size: size });
          for (const width of [Math.round(300 * unit), Math.round(output.width * 0.8)]) {
            const badge = placeBadge(content, { width: Math.round(content[2] / 2), height: Math.round(37 * unit) }, unit, bubble);
            const where = `${output.width}x${output.height} ${corner} ${size} ${width}`;
            expect(inside(badge, output) && !overlap(badge, bubble), `badge ${where}`).toBe(true);
            for (const position of ['top', 'bottom'] as const) {
              for (const align of ['left', 'center'] as const) {
                const text = placeOverlay(output, { width, height: Math.round(67 * unit) }, position, align, [bubble, badge]);
                expect(inside(text, output) && !overlap(text, bubble) && !overlap(text, badge), `${position} ${align} ${where}`).toBe(true);
              }
            }
          }
        }
      }
    }
  });
});

describe('stillCrop', () => {
  const view = { width: 1600, height: 1000 };
  const page = { width: 1280, height: 2400 };

  it('shows the top of a tall image at the view width', () => {
    expect(stillCrop(page, view, 'none', 0.5)).toEqual([0, 0, 1280, 800]);
  });

  it('scrolls a tall image from top to bottom, eased', () => {
    expect(stillCrop(page, view, 'scroll', 0)).toEqual([0, 0, 1280, 800]);
    expect(stillCrop(page, view, 'scroll', 0.5)).toEqual([0, 800, 1280, 800]);
    expect(stillCrop(page, view, 'scroll', 1)).toEqual([0, 1600, 1280, 800]);
  });

  it('covers the view with a wide image, centred', () => {
    expect(stillCrop({ width: 2000, height: 500 }, view, 'none', 0)).toEqual([600, 0, 800, 500]);
    expect(stillCrop({ width: 2000, height: 500 }, view, 'scroll', 1)).toEqual([600, 0, 800, 500]);
  });

  it('zooms into the centre for kenburns', () => {
    expect(stillCrop(page, view, 'kenburns', 0)).toEqual([0, 0, 1280, 800]);
    const [x, y, w, h] = stillCrop(page, view, 'kenburns', 1);
    expect(w).toBeCloseTo(1280 / 1.08);
    expect(h).toBeCloseTo(800 / 1.08);
    expect(x + w / 2).toBeCloseTo(640);
    expect(y + h / 2).toBeCloseTo(400);
  });
});

describe('clipView', () => {
  const output = { width: 1920, height: 1080 };
  const screen = { width: 2560, height: 1440 };
  const look = (enabled: boolean) => ({ frame: { enabled, style: 'mac-dark' as const, title: '', radius: 14, shadow: true } });

  it('is the whole screen over the whole output without a frame, and the window content with one', () => {
    expect(clipView(output, look(false), {}, screen)).toEqual({ zoom: [0, 0, 2560, 1440], content: [0, 0, 1920, 1080] });
    const framed = clipView(output, look(true), {}, screen);
    expect(framed.content).toEqual(windowLayout(output, 2560 / 1440, { titleBar: 36, radius: 14 }).content);
  });

  it('takes the layer’s zoom and a crop’s shape', () => {
    const view = clipView(output, look(false), { zoom: [100, 100, 1280, 720], aspect: 4 / 3 }, screen);
    expect(view.zoom).toEqual([100, 100, 1280, 720]);
    expect(view.content).toEqual([240, 0, 1440, 1080]);
  });
});

import { ShotSchema, type ShotInput } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { FRAME_CHROME, WINDOW_SHADOW } from '../src/presets/frames';
import { shotLayout } from '../src/shot';

const shot = (input: Partial<ShotInput> = {}) => ShotSchema.parse({ version: 1, source: 'source.png', ...input });
const flat = { radius: 0, shadow: false };

describe('shotLayout', () => {
  it('puts the image pixel for pixel in a canvas its padding larger', () => {
    const placed = shotLayout(shot({ padding: 40, frame: flat }), { width: 800, height: 500 });
    expect(placed.output).toEqual({ width: 880, height: 580 });
    expect(placed.layout.content).toEqual([40, 40, 800, 500]);
    expect(placed.layout.window).toEqual([40, 40, 800, 500]);
    expect(placed.crop).toEqual([0, 0, 800, 500]);
  });

  it("draws the frame, the padding and the corners at the shot's own scale and keeps the image's pixels", () => {
    // a Retina shot: 2 px a point
    const placed = shotLayout(shot({ scale: 2, padding: 40, frame: { style: 'mac-dark', radius: 10, shadow: false } }), { width: 1600, height: 1000 });
    const titleBar = FRAME_CHROME['mac-dark'].titleBar * 2;
    expect(placed.scale).toBe(2);
    expect(placed.layout.titleBar).toBe(titleBar);
    expect(placed.layout.content).toEqual([80, 80 + titleBar, 1600, 1000]);
    expect(placed.layout.radius).toBe(20);
    expect(placed.output).toEqual({ width: 1760, height: 1160 + titleBar });
    // drawn at 1 px a point instead: the image at half its pixels
    expect(shotLayout(shot({ scale: 2, padding: 40, frame: flat }), { width: 1600, height: 1000 }, 1).layout.content).toEqual([40, 40, 800, 500]);
  });

  it('shows only the crop', () => {
    const placed = shotLayout(shot({ padding: 10, crop: [100, 50, 300, 200], frame: flat }), { width: 800, height: 500 });
    expect(placed.layout.content).toEqual([10, 10, 300, 200]);
    expect(placed.crop).toEqual([100, 50, 300, 200]);
    // a crop past the image's edge stops there
    expect(shotLayout(shot({ padding: 0, crop: [700, 400, 300, 300], frame: flat }), { width: 800, height: 500 }).crop).toEqual([700, 400, 100, 100]);
  });

  it('grows the canvas to a ratio around the shot, centred, and keeps its pixels', () => {
    const placed = shotLayout(shot({ padding: 0, size: '16:9', frame: flat }), { width: 100, height: 100 });
    expect(placed.output).toEqual({ width: 178, height: 100 });
    expect(placed.layout.content).toEqual([39, 0, 100, 100]);
    const tall = shotLayout(shot({ padding: 0, size: '9:16', frame: flat }), { width: 100, height: 100 });
    expect(tall.output).toEqual({ width: 100, height: 178 });
    expect(tall.layout.content).toEqual([0, 39, 100, 100]);
  });

  it('fits the shot into pixels: smaller when it must be, never larger', () => {
    const fitted = shotLayout(shot({ padding: 0, size: { width: 300, height: 200 }, frame: flat }), { width: 1000, height: 500 });
    expect(fitted.output).toEqual({ width: 300, height: 200 });
    expect(fitted.layout.content).toEqual([0, 25, 300, 150]);
    expect(fitted.scale).toBeCloseTo(0.3);
    const small = shotLayout(shot({ padding: 0, size: { width: 300, height: 200 }, frame: flat }), { width: 100, height: 50 });
    expect(small.layout.content).toEqual([100, 75, 100, 50]);
    expect(small.scale).toBe(1);
    // the padding and the chrome shrink with it, and all of it fits
    const framed = shotLayout(shot({ padding: 64, size: { width: 1200, height: 630 }, frame: { style: 'browser-dark' } }), { width: 2880, height: 1800 });
    const [x, y, w, h] = framed.layout.window;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(1200);
    expect(y + h).toBeLessThanOrEqual(630);
  });

  it('keeps the whole shadow on a transparent canvas, however small the padding', () => {
    const placed = shotLayout(shot({ padding: 0, transparent: true }), { width: 400, height: 300 });
    const blur = WINDOW_SHADOW.blur;
    const offset = WINDOW_SHADOW.offset;
    expect(placed.layout.window).toEqual([blur, blur - offset, 400, 300]);
    expect(placed.output).toEqual({ width: 400 + 2 * blur, height: 300 + 2 * blur });
    // on a background, the padding alone
    expect(shotLayout(shot({ padding: 0 }), { width: 400, height: 300 }).output).toEqual({ width: 400, height: 300 });
  });

  it("puts a phone's bezel around the screen and clips to the screen inside it", () => {
    const placed = shotLayout(shot({ padding: 20, frame: { style: 'iphone', shadow: false } }), { width: 390, height: 844 });
    const band = Math.round(FRAME_CHROME.iphone.device!.bezel * 390);
    expect(placed.layout.content).toEqual([20 + band, 20 + band, 390, 844]);
    expect(placed.layout.clip).toEqual(placed.layout.content);
    expect(placed.layout.window).toEqual([20, 20, 390 + 2 * band, 844 + 2 * band]);
  });

  it('puts the shot where align says in a canvas larger than it', () => {
    const at = (align: 'top' | 'bottom' | 'left' | 'right') => shotLayout(shot({ padding: 10, size: '1:1', align, frame: flat }), { width: 200, height: 100 }).layout.content;
    // a 220×120 shot in a 220×220 canvas
    expect(at('top')).toEqual([10, 10, 200, 100]);
    expect(at('bottom')).toEqual([10, 110, 200, 100]);
    const wide = (align: 'left' | 'right') => shotLayout(shot({ padding: 10, size: '16:9', align, frame: flat }), { width: 100, height: 100 }).layout.content;
    // a 120×120 shot in a 213×120 canvas
    expect(wide('left')).toEqual([10, 10, 100, 100]);
    expect(wide('right')).toEqual([103, 10, 100, 100]);
  });

  it('lets the shot bleed past the edge it is aligned to: that share of it cut off there', () => {
    const placed = shotLayout(shot({ padding: 20, size: '1:1', align: 'bottom', bleed: 0.25, frame: flat }), { width: 400, height: 200 });
    const [, y, , h] = placed.layout.window;
    expect(h).toBe(200);
    // a quarter of it past the bottom edge, none of the padding there
    expect(y + h - placed.output.height).toBe(50);
    expect(placed.output).toEqual({ width: 440, height: 440 });
    const top = shotLayout(shot({ padding: 20, size: '1:1', align: 'top', bleed: 0.25, frame: flat }), { width: 400, height: 200 });
    expect(top.layout.window[1]).toBe(-50);
  });

  it('makes room for a headline above or below the shot, and keeps it away from an edge the shot bleeds past', () => {
    const headline = { title: 'Ship it', subtitle: 'In one go' };
    const above = shotLayout(shot({ padding: 10, headline, frame: flat }), { width: 300, height: 100 });
    // 40 pt and 20 pt lines (1.3 em), 8 pt between them, 28 pt to the shot
    const band = 52 + 8 + 26 + 28;
    expect(above.output).toEqual({ width: 320, height: 120 + band });
    expect(above.headline).toMatchObject({ title: 10, subtitle: 10 + 52 + 8, maxWidth: 300 });
    expect(above.layout.content).toEqual([10, 10 + band, 300, 100]);
    const below = shotLayout(shot({ padding: 10, headline: { ...headline, position: 'below' }, frame: flat }), { width: 300, height: 100 });
    expect(below.layout.content).toEqual([10, 10, 300, 100]);
    expect(below.headline?.title).toBe(10 + 100 + 28);
    const bleeding = shotLayout(shot({ padding: 10, size: '1:1', align: 'top', bleed: 0.2, headline, frame: flat }), { width: 300, height: 100 });
    expect(bleeding.headline!.title).toBeGreaterThan(bleeding.layout.window[1] + 100);
  });

  it("grows a large shot's headline with it: the title 6 % of its width, all of its type alike", () => {
    // 1280 points wide (a Retina screenshot of 2560 px): a 76.8 pt title, a 38.4 pt line under it
    const large = shotLayout(shot({ scale: 2, padding: 10, headline: { title: 'Ship it', subtitle: 'In one go' }, frame: flat }), { width: 2560, height: 1600 });
    expect(large.headline!.type).toEqual({ title: 76.8, subtitle: 38.4, gap: 15.36, space: 53.76 });
    // its band at 2 px a point
    const band = Math.round(Math.round(76.8 * 2) * 1.3) + Math.round(15.36 * 2) + Math.round(Math.round(38.4 * 2) * 1.3) + Math.round(53.76 * 2);
    expect(large.layout.content[1]).toBe(20 + band);
  });

  it('refuses a canvas larger than a canvas can be', () => {
    expect(() => shotLayout(shot({ padding: 0, frame: flat }), { width: 9000, height: 9000 }, 2)).toThrow(/more than 16384 px/);
  });
});

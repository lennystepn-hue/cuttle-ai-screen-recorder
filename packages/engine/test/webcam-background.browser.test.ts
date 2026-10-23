import { parseProject, type CuttleProject, type CuttleProjectInput } from '@cuttle/project';
import type { RenderState, SceneFrame } from '@cuttle/timeline';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { webcamRect } from '../src/layout';
import { createRenderer, type FrameSources } from '../src/renderer';
import { loadSegmenter, type PersonMask, type Segmenter } from '../src/segment';
import { SEGMENTER_FILES } from '../src/segment-files';
import { SCREEN, fakeScreen } from './fixtures';
import { pixelAt, readPixels } from './gl-util';

let assets: EngineAssets;

beforeAll(async () => {
  assets = await loadEngineAssets();
});

/** A camera frame: `paint` colours each pixel. */
function cameraFrame(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): VideoFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return new VideoFrame(data, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: 0 });
}

function project(webcam: Record<string, unknown>): CuttleProject {
  const input = {
    version: 1,
    output: { width: 200, height: 200 },
    sources: { screen: 's.mp4', webcam: 'w.mp4' },
    look: { background: { preset: 'solid', color: '#000000' }, webcam: { enabled: true, shape: 'square', size: 0.5, corner: 'top-left', border: false, shadow: false, ...webcam } },
    scenes: [{ type: 'clip', from: 0, to: 1 }],
  } as CuttleProjectInput;
  const result = parseProject(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

/** The person in the left half of every frame. */
const leftHalf: Segmenter = (frame) => {
  const { displayWidth: width, displayHeight: height } = frame as VideoFrame;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) data.fill(255, y * width, y * width + Math.floor(width / 2));
  return { width, height, data } satisfies PersonMask;
};

/** The bubble's colour a quarter of its width left and right of its middle. */
function sides(look: CuttleProject, camera: VideoFrame, segmenter?: Segmenter) {
  const canvas = new OffscreenCanvas(1, 1);
  const renderer = createRenderer(canvas, look, { assets, screenSize: SCREEN, ...(segmenter && { segmenter: () => segmenter }) });
  const layer: SceneFrame = { index: 0, sceneIndex: 0, kind: 'clip', local: 0, progress: 0, opacity: 1, masks: [], texts: [], overlays: [], sourceTime: 0 };
  const state: RenderState = { t: 0, layers: [layer] };
  const sources: FrameSources = { screens: new Map([[0, fakeScreen()]]), webcams: new Map([[0, camera]]), stills: new Map(), motion: new Map(), overlays: new Map() };
  renderer.render(state, sources);
  const gl = canvas.getContext('webgl2')!;
  const pixels = readPixels(gl);
  renderer.dispose();
  const [x, y, w, h] = webcamRect({ width: 200, height: 200 }, look.look.webcam);
  const at = (dx: number) => pixelAt(pixels, Math.round(x + w / 2 + dx * w), Math.round(y + h / 2));
  return { left: at(-0.25), right: at(0.25) };
}

const near = (pixel: readonly number[], rgb: readonly number[], tolerance = 12) => rgb.every((value, i) => Math.abs(pixel[i]! - value) <= tolerance);

describe("the webcam's background", () => {
  it("loads the segmentation model offline and finds the person in a frame: a mask over the whole frame, at the model's size", async () => {
    const segment = await loadSegmenter(SEGMENTER_FILES);
    const frame = cameraFrame(320, 180, (x) => [x % 255, 120, 90]);
    const mask = segment(frame);
    frame.close();
    expect(mask).toBeDefined();
    expect([mask!.width, mask!.height]).toEqual([256, 144]);
    expect(mask!.data.length).toBe(256 * 144);
  });

  it('keeps the room as filmed without a background, or without a segmenter', () => {
    const red = cameraFrame(64, 64, () => [220, 30, 30]);
    for (const { left, right } of [sides(project({}), red, leftHalf), sides(project({ background: 'color' }), red)]) {
      expect(near(left, [220, 30, 30])).toBe(true);
      expect(near(right, [220, 30, 30])).toBe(true);
    }
    red.close();
  });

  it('puts a colour behind the person, or nothing: the person alone', () => {
    const red = cameraFrame(64, 64, () => [220, 30, 30]);
    const coloured = sides(project({ background: 'color', backgroundColor: '#00c000' }), red, leftHalf);
    expect(near(coloured.left, [220, 30, 30])).toBe(true);
    expect(near(coloured.right, [0, 192, 0])).toBe(true);
    // removed: the screen behind shows where the room was, the person stays
    const alone = sides(project({ background: 'remove' }), red, leftHalf);
    expect(near(alone.left, [220, 30, 30])).toBe(true);
    expect(near(alone.right, [220, 30, 30], 60)).toBe(false);
    red.close();
  });

  it('blurs the room behind the person and leaves the person sharp', () => {
    // stripes two px wide: blurred, they become one even colour
    const stripes = cameraFrame(256, 256, (x) => (Math.floor(x / 2) % 2 ? [255, 255, 255] : [0, 0, 0]));
    const look = project({ background: 'blur' });
    const canvasOf = (segmenter: Segmenter) => {
      const samples: number[] = [];
      const [x, y, w, h] = webcamRect({ width: 200, height: 200 }, look.look.webcam);
      const canvas = new OffscreenCanvas(1, 1);
      const renderer = createRenderer(canvas, look, { assets, screenSize: SCREEN, segmenter: () => segmenter });
      const layer: SceneFrame = { index: 0, sceneIndex: 0, kind: 'clip', local: 0, progress: 0, opacity: 1, masks: [], texts: [], overlays: [], sourceTime: 0 };
      renderer.render({ t: 0, layers: [layer] }, { screens: new Map([[0, fakeScreen()]]), webcams: new Map([[0, stripes]]), stills: new Map(), motion: new Map(), overlays: new Map() });
      const pixels = readPixels(canvas.getContext('webgl2')!);
      renderer.dispose();
      // the spread of the brightness along a row, in each half
      const spread = (from: number, to: number) => {
        const row = Array.from({ length: Math.round((to - from) * w) }, (_, i) => pixelAt(pixels, Math.round(x + from * w + i), Math.round(y + h / 2))[0]!);
        return Math.max(...row) - Math.min(...row);
      };
      samples.push(spread(0.1, 0.4), spread(0.6, 0.9));
      return samples;
    };
    const [personSpread, roomSpread] = canvasOf(leftHalf);
    expect(personSpread).toBeGreaterThan(100);
    expect(roomSpread).toBeLessThan(40);
    stripes.close();
  });
});

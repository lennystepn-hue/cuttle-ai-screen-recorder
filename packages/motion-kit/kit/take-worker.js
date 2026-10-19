// Reads a video's frames for a motion page, in a worker of its own (one per video), so the page's
// virtual clock does not hold it up: the screen recording's (`cuttle.take.frame`) or a video of the
// project's (`cuttle.video`). mediabunny reads the file over the project's URL (in ranges) and
// WebCodecs decodes it, on forward from the frame asked last where it can. Each frame goes back to the
// page as an ImageBitmap; the recording's with the project's privacy masks painted over it as the
// video paints them: `fill` with the colour around it, `blur` beyond reading.
//
// Messages: { type: 'open', url, name, masks } once (`name` says what the video is, in errors), then
// { type: 'frame', id, source, width? }; each frame is answered with { id, bitmap } or { id, error },
// in the order asked.
import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from './mediabunny/mediabunny.min.mjs';
import { masksAt, ringColor } from './take.js';

/** Further ahead than this (seconds), decoding starts again at the key frame before the time asked. */
const JUMP = 3;
/** The widest frame a page gets (px). */
const MAX_WIDTH = 4096;
/** Pixels around a fill mask whose colour fills it. */
const RING = 3;

let take;
let failure;
let iterator;
let current;
let upcoming;
let ended = false;
let startedAt = -Infinity;
let last = -Infinity;

async function open({ url, name = 'the screen recording', masks }) {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error(String(name) + ' has no video track');
  if (!(await track.canDecode())) throw new Error(String(name) + ' cannot be decoded here');
  take = { name, sink: new VideoSampleSink(track), first: await track.getFirstTimestamp(), width: track.displayWidth, height: track.displayHeight, masks: masks ?? [] };
}

function restart(t) {
  void iterator?.return();
  current?.close();
  upcoming?.close();
  current = upcoming = undefined;
  ended = false;
  startedAt = t;
  iterator = take.sink.samples(t);
}

/** The frame shown at `t`: the last one starting by then (the first, before it). */
async function sampleAt(t) {
  const reached = current?.timestamp ?? startedAt;
  if (!iterator || t < last - 1e-6 || t > reached + JUMP) restart(t);
  last = t;
  for (;;) {
    if (!upcoming && !ended) {
      const step = await iterator.next();
      if (step.done) ended = true;
      else upcoming = step.value;
    }
    if (!upcoming || upcoming.timestamp > t + 1e-6) break;
    current?.close();
    current = upcoming;
    upcoming = undefined;
  }
  return current ?? upcoming;
}

/** Fills a mask with the colour just around it. */
function fill(ctx, [x, y, w, h], width, height) {
  const left = Math.max(0, x - RING);
  const top = Math.max(0, y - RING);
  const right = Math.min(width, x + w + RING);
  const bottom = Math.min(height, y + h + RING);
  const region = ctx.getImageData(left, top, right - left, bottom - top);
  const [r, g, b] = ringColor(region.data, region.width, [x - left, y - top, w, h]);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(x, y, w, h);
}

/** Blurs a mask beyond reading: down to a few pixels on its short side, then up again, softened. */
function blur(canvas, ctx, [x, y, w, h]) {
  const factor = Math.max(10, Math.min(w, h) / 6);
  const small = new OffscreenCanvas(Math.max(1, Math.round(w / factor)), Math.max(1, Math.round(h / factor)));
  const s = small.getContext('2d');
  s.imageSmoothingQuality = 'high';
  s.drawImage(canvas, x, y, w, h, 0, 0, small.width, small.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const pad = Math.ceil(factor);
  ctx.filter = `blur(${Math.max(2, Math.round(factor / 2))}px)`;
  ctx.drawImage(small, x - pad, y - pad, w + 2 * pad, h + 2 * pad);
  ctx.restore();
}

async function frame({ id, source, width }) {
  if (!take) throw failure ?? new Error('the video is not open');
  const t = Math.max(Number.isFinite(source) ? source : 0, take.first);
  const sample = await sampleAt(t);
  if (!sample) throw new Error(`${take.name} has no frame at ${t.toFixed(3)} s`);
  const w = Math.min(MAX_WIDTH, Math.max(1, Math.round(width ?? take.width)));
  const h = Math.max(1, Math.round((take.height * w) / take.width));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  sample.draw(ctx, 0, 0, w, h);
  for (const mask of masksAt(take.masks, t, w / take.width, w, h)) {
    if (mask.style === 'blur') blur(canvas, ctx, mask.rect);
    else fill(ctx, mask.rect, w, h);
  }
  const bitmap = canvas.transferToImageBitmap();
  self.postMessage({ id, bitmap }, [bitmap]);
}

// one message at a time, in order: the frames go forward through the file
let queue = Promise.resolve();
self.onmessage = (event) => {
  const message = event.data;
  queue = queue.then(async () => {
    try {
      if (message.type === 'open') await open(message);
      else if (message.type === 'frame') await frame(message);
    } catch (error) {
      if (message.type === 'open') failure = error instanceof Error ? error : new Error(String(error));
      else self.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
};

// The take's frames for motion pages (`cuttle.take.frame`): where the project's privacy masks are at
// a moment, in a frame's pixels, and the colour that fills one. The kit's worker (take-worker.js)
// reads the frames and paints the masks with these, as the video masks the clips.

/**
 * Where a mask is at source second `t`, in source px, or null while it is off. One that follows text
 * covers, between two of its places, both of them (as the video masks it).
 */
export function maskRectAt(mask, t) {
  if (!(t >= mask.from && t < mask.to)) return null;
  const places = [{ at: mask.from, rect: mask.rect }, ...(mask.moves ?? [])];
  let i = 0;
  while (i + 1 < places.length && places[i + 1].at <= t) i++;
  const here = places[i].rect;
  const next = places[i + 1]?.rect;
  if (!next) return here;
  const left = Math.min(here[0], next[0]);
  const top = Math.min(here[1], next[1]);
  return [left, top, Math.max(here[0] + here[2], next[0] + next[2]) - left, Math.max(here[1] + here[3], next[1] + next[3]) - top];
}

/**
 * The masks on at `t` in a frame `width`×`height` px that shows the recording at `scale` (frame px a
 * source px): whole pixels, grown outward to cover every partly masked one, kept inside the frame.
 */
export function masksAt(masks, t, scale, width, height) {
  const shown = [];
  for (const mask of masks) {
    const rect = maskRectAt(mask, t);
    if (!rect) continue;
    const x = Math.max(0, Math.floor(rect[0] * scale));
    const y = Math.max(0, Math.floor(rect[1] * scale));
    const right = Math.min(width, Math.ceil((rect[0] + rect[2]) * scale));
    const bottom = Math.min(height, Math.ceil((rect[1] + rect[3]) * scale));
    if (right > x && bottom > y) shown.push({ style: mask.style === 'blur' ? 'blur' : 'fill', rect: [x, y, right - x, bottom - y] });
  }
  return shown;
}

/**
 * The mean colour of the pixels around a mask: RGBA `data` of a region `width` px wide holds the mask
 * at `inner` ([x, y, w, h] in the region) and a ring around it; the ring's pixels are averaged.
 * Without a ring (a mask over the whole frame), the mean of the mask itself.
 */
export function ringColor(data, width, inner) {
  const height = data.length / 4 / width;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const [ix, iy, iw, ih] = inner;
  for (const ring of [true, false]) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inside = x >= ix && x < ix + iw && y >= iy && y < iy + ih;
        if (ring === inside) continue;
        const i = (y * width + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
    }
    if (count > 0) break;
  }
  return count === 0 ? [0, 0, 0] : [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

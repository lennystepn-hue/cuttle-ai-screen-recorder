import { describe, expect, it } from 'vitest';
import { parseProject } from '@cuttle/project';
import { applyCommand, clampRect, describeChange, DocumentError, ensureIds, firstChanged, pinIds, replayCommands, type Command, type Raw } from '../src/shared/document';
import { adjustRect, dragRange, drawnRect, fitInside, overlayRange, rangeFields, snapTime, toSource, toStage } from '../src/shared/edit';

const base: Raw = {
  version: 1,
  sources: { screen: 'takes/1/screen.mp4' },
  scenes: [
    { type: 'clip', id: 's1', label: 'Prompt', from: 0, to: 3 },
    { type: 'clip', id: 's2', from: 3, to: 8, speed: 4 },
    { type: 'card', id: 's3', title: 'The end', duration: 1.5 },
  ],
  zooms: [{ id: 'z1', at: 4, duration: 2, rect: [0, 0, 640, 360] }],
  texts: [{ id: 't1', at: 1, duration: 1, text: 'Hi' }],
};
const limits = { sourceEnd: 12, screen: { width: 1280, height: 800 }, fps: 30 };
const project = (raw: Raw) => {
  const parsed = parseProject(raw);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
};

describe('the document', () => {
  it('gives items without an id one, and leaves a file whose items have ids as it is', () => {
    expect(ensureIds(base)).toBe(base);
    const named = ensureIds({ ...base, masks: [{ from: 0, to: 1, rect: [0, 0, 10, 10] }], zooms: [{ at: 0, duration: 1, rect: [0, 0, 10, 10] }] });
    expect([(named.masks as { id: string }[])[0]!.id, (named.zooms as { id: string }[])[0]!.id]).toEqual(['m1', 'z1']);
  });

  it('splits a clip into a continuous cut and leaves the input as it was', () => {
    const next = applyCommand(base, { type: 'split', id: 's2', at: 5 }, limits);
    expect((next.scenes as unknown[]).slice(1, 3)).toEqual([
      { type: 'clip', id: 's2', from: 3, to: 5, speed: 4 },
      { type: 'clip', id: 's4', from: 5, to: 8, speed: 4 },
    ]);
    expect((base.scenes as unknown[]).length).toBe(3);
    expect(() => applyCommand(base, { type: 'split', id: 's2', at: 9 }, limits)).toThrow(/outside the clip/);
  });

  it('trims a clip inside the take and at least a frame long; a card by its duration', () => {
    const trimmed = applyCommand(base, { type: 'trim', id: 's1', from: -2, to: 30 }, limits);
    expect((trimmed.scenes as { from?: number; to?: number }[])[0]).toMatchObject({ from: 0, to: 12 });
    const thin = applyCommand(base, { type: 'trim', id: 's1', from: 2.99, to: 2.99 }, limits);
    expect((thin.scenes as { from: number; to: number }[])[0]!.to - (thin.scenes as { from: number }[])[0]!.from).toBeCloseTo(1 / 30, 5);
    const card = applyCommand(base, { type: 'trim', id: 's3', duration: 2.5 }, limits);
    expect((card.scenes as { duration?: number }[])[2]!.duration).toBe(2.5);
  });

  it('stops a trimmed edge a frame before the other one, and refuses a speed that leaves less than a frame', () => {
    const late = applyCommand(base, { type: 'trim', id: 's1', from: 5 }, limits);
    expect((late.scenes as { from: number; to: number }[])[0]).toMatchObject({ from: 2.966667, to: 3 });
    const early = applyCommand(base, { type: 'trim', id: 's1', to: -1 }, limits);
    expect((early.scenes as { from: number; to: number }[])[0]).toMatchObject({ from: 0, to: 0.033333 });
    const short = applyCommand(base, { type: 'trim', id: 's1', to: 0.5 }, limits);
    expect(() => applyCommand(short, { type: 'speed', id: 's1', speed: 64 }, limits)).toThrow(DocumentError);
  });

  it('keeps the output length of zooms and captions inside a clip whose speed changes', () => {
    const next = applyCommand(base, { type: 'speed', id: 's2', speed: 8 }, limits);
    expect((next.scenes as { speed?: number }[])[1]!.speed).toBe(8);
    // the zoom lies inside 3–8 s: 2 source s at 4× is 0.5 s; at 8× it takes 4 source s for 0.5 s (clamped to the clip's end)
    expect((next.zooms as { duration: number }[])[0]!.duration).toBe(4);
    // the caption is in the first clip: untouched
    expect((next.texts as { duration: number }[])[0]!.duration).toBe(1);
  });

  it('moves, adds, duplicates, sets and deletes items by id', () => {
    let raw = applyCommand(base, { type: 'move-scene', id: 's3', index: 0 }, limits);
    expect((raw.scenes as { id: string }[]).map((scene) => scene.id)).toEqual(['s3', 's1', 's2']);
    raw = applyCommand(raw, { type: 'add', list: 'masks', item: { from: 1, to: 2, rect: [10, 10, 5000, 50] } }, limits);
    expect((raw.masks as unknown[])[0]).toEqual({ from: 1, to: 2, rect: [10, 10, 1270, 50], id: 'm1' });
    raw = applyCommand(raw, { type: 'duplicate', list: 'texts', id: 't1', shift: 2 }, limits);
    expect((raw.texts as { id: string; at: number }[]).map((text) => [text.id, text.at])).toEqual([
      ['t1', 1],
      ['t2', 3],
    ]);
    raw = applyCommand(raw, { type: 'set', list: 'texts', id: 't2', fields: { text: 'Bye', style: 'caption' } }, limits);
    expect((raw.texts as { text: string }[])[1]).toMatchObject({ text: 'Bye', style: 'caption' });
    raw = applyCommand(raw, { type: 'delete', list: 'zooms', id: 'z1' }, limits);
    expect(raw.zooms).toEqual([]);
    expect(() => applyCommand(raw, { type: 'delete', list: 'zooms', id: 'z1' }, limits)).toThrow(DocumentError);
  });

  it('shifts overlays in source seconds, never before 0', () => {
    const next = applyCommand(base, { type: 'shift', list: 'zooms', id: 'z1', by: -10 }, limits);
    expect((next.zooms as { at: number }[])[0]!.at).toBe(0);
  });

  it('sets the look and the output, and refuses what parseProject refuses', () => {
    const next = applyCommand(base, { type: 'look', path: ['background', 'preset'], value: 'aurora' }, limits);
    expect(next.look).toEqual({ background: { preset: 'aurora' } });
    expect(applyCommand(base, { type: 'output', width: 1080, height: 1920 }, limits).output).toEqual({ width: 1080, height: 1920 });
    expect(() => applyCommand(base, { type: 'look', path: ['background', 'preset'], value: 'solid' }, limits)).toThrow(/color/);
  });

  it('replays commands on a newer version and drops the ones whose item is gone (deleting it is done already)', () => {
    const newer = applyCommand(base, { type: 'delete', list: 'texts', id: 't1' }, limits);
    const { raw, dropped } = replayCommands(newer, [
      { type: 'set', list: 'texts', id: 't1', fields: { text: 'Lost' } },
      { type: 'set', list: 'scenes', id: 's1', fields: { label: 'Kept' } },
      { type: 'delete', list: 'texts', id: 't1' },
    ], limits);
    expect(dropped).toEqual(['text t1 is not in the project any more']);
    expect((raw.scenes as { label?: string }[])[0]!.label).toBe('Kept');
  });

  it('pins the id a new item got, and leaves it out of a replay where another item has it now', () => {
    const add = { type: 'add', list: 'zooms', item: { at: 1, duration: 2, rect: [0, 0, 640, 360] } } as const;
    const mine = applyCommand(base, add, limits);
    const pinned = pinIds(base, mine, add);
    expect(pinned).toEqual({ ...add, item: { ...add.item, id: 'z2' } });
    // Claude added a zoom meanwhile: it got z2 too
    const claude = applyCommand(base, { type: 'add', list: 'zooms', item: { id: 'z2', label: 'From Claude', at: 9, duration: 1, rect: [0, 0, 640, 400] } }, limits);
    const { raw, dropped } = replayCommands(claude, [pinned, { type: 'set', list: 'zooms', id: 'z2', fields: { rect: [10, 10, 640, 400] } }], limits);
    expect(dropped).toHaveLength(2);
    // Claude's zoom is as Claude left it
    expect((raw.zooms as { id: string; label?: string; rect: number[] }[]).map((zoom) => [zoom.id, zoom.label, zoom.rect[0]])).toEqual([
      ['z1', undefined, 0],
      ['z2', 'From Claude', 0],
    ]);
  });

  it('says what changed between two versions', () => {
    const after = applyCommand(applyCommand(base, { type: 'add', list: 'masks', item: { from: 0, to: 1, rect: [0, 0, 10, 10] } }), { type: 'add', list: 'masks', item: { from: 1, to: 2, rect: [0, 0, 10, 10] } });
    const changed = applyCommand(after, { type: 'set', list: 'scenes', id: 's1', fields: { label: 'Ask' } });
    expect(describeChange(project(base), project(changed))).toBe('1 scene changed · 2 masks added');
    expect(describeChange(project(base), project(base))).toBe('no visible change');
    // the first change to show: the scene comes before the masks
    expect(firstChanged(project(base), project(changed))).toEqual({ list: 'scenes', id: 's1' });
    expect(firstChanged(project(base), project(after))).toEqual({ list: 'masks', id: project(after).masks[0]!.id });
    expect(firstChanged(project(base), project(base))).toBeUndefined();
  });

  it('keeps a rectangle inside the screen', () => {
    expect(clampRect([-10, 790, 4, 50], { width: 1280, height: 800 })).toEqual([0, 790, 8, 10]);
  });
});

describe('the gestures', () => {
  it('snaps to the nearest target in reach, else to frames', () => {
    expect(snapTime(4.03, [4, 4.1], 0.05, 30)).toEqual({ t: 4, target: 4 });
    expect(snapTime(4.02, [5], 0.05, 30).t).toBeCloseTo(121 / 30, 9);
  });

  it("turns a drag in output seconds into source seconds at the clip's speed", () => {
    expect(dragRange([4, 6], 'move', 0.5, 4, 0.1)).toEqual([6, 8]);
    expect(dragRange([4, 6], 'move', -3, 4, 0.1)).toEqual([0, 2]);
    expect(dragRange([4, 6], 'start', 1, 4, 0.1)).toEqual([5.9, 6]);
    expect(dragRange([4, 6], 'end', -0.25, 2, 0.1)).toEqual([4, 5.5]);
    expect(overlayRange({ at: 2, duration: 3 })).toEqual([2, 5]);
    expect(overlayRange({ from: 1, to: 4 })).toEqual([1, 4]);
    expect(rangeFields('masks', 1, 2)).toEqual({ from: 1, to: 2 });
    expect(rangeFields('zooms', 1, 3)).toEqual({ at: 1, duration: 2 });
  });

  it('maps the stage to source pixels and back', () => {
    const fit = fitInside({ width: 1000, height: 500 }, { width: 1280, height: 800 });
    expect(fit.scale).toBeCloseTo(500 / 800, 9);
    expect(toSource({ x: fit.x, y: 0 }, fit)).toEqual({ x: 0, y: 0 });
    const box = toStage([640, 400, 320, 200], fit);
    expect(box.width).toBeCloseTo(200, 9);
    expect(toSource({ x: box.x, y: box.y }, fit).x).toBeCloseTo(640, 9);
  });

  it("draws a rectangle inside the screen, a zoom's with the screen's shape", () => {
    const screen = { width: 1280, height: 800 };
    expect(drawnRect({ x: 100, y: 100 }, { x: 50, y: 900 }, screen)).toEqual([50, 100, 50, 700]);
    const zoom = drawnRect({ x: 1000, y: 100 }, { x: 1600, y: 200 }, screen, 1.6);
    expect(zoom[2] / zoom[3]).toBeCloseTo(1.6, 9);
    expect(zoom[0] + zoom[2]).toBeLessThanOrEqual(1280);
  });

  it("moves and resizes a rectangle by a handle, inside the screen, keeping a zoom's shape", () => {
    const screen = { width: 1280, height: 800 };
    expect(adjustRect([100, 100, 200, 100], 'move', 2000, -50, screen)).toEqual([1080, 50, 200, 100]);
    expect(adjustRect([100, 100, 200, 100], 'se', 100, 0, screen)).toEqual([100, 100, 300, 100]);
    expect(adjustRect([100, 100, 200, 100], 'w', 500, 0, screen)).toEqual([292, 100, 8, 100]);
    const zoom = adjustRect([100, 100, 320, 200], 'se', 160, 0, screen, 1.6);
    expect(zoom).toEqual([100, 100, 480, 300]);
    const big = adjustRect([800, 400, 320, 200], 'se', 2000, 0, screen, 1.6);
    expect(big[0] + big[2]).toBeLessThanOrEqual(1280 + 1e-9);
    expect(big[2] / big[3]).toBeCloseTo(1.6, 9);
  });
});

describe('random edit sequences', () => {
  /** A small seeded generator: the same sequences on every run. */
  const random = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };

  /** A command on the document as it is: mostly on items it has, some on ones it lacks, some out of range. */
  function command(raw: Raw, next: () => number): Command {
    const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
    const number = (low: number, high: number) => low + next() * (high - low);
    const lists = ['scenes', 'zooms', 'masks', 'texts'] as const;
    const list = pick(lists);
    const items = (raw[list] as { id: string; type?: string }[] | undefined) ?? [];
    const id = items.length > 0 && next() > 0.1 ? pick(items).id : 'gone';
    const clip = (raw.scenes as { id: string; type: string }[]).find((scene) => scene.type === 'clip' && next() > 0.3)?.id ?? 'gone';
    const overlay = list === 'scenes' ? pick(['zooms', 'masks', 'texts'] as const) : list;
    const overlayId = ((raw[overlay] as { id: string }[] | undefined) ?? [])[0]?.id ?? 'gone';
    const rect = [number(-200, 1400), number(-200, 900), number(-50, 1500), number(-50, 900)];
    switch (Math.floor(next() * 11)) {
      case 0:
        return { type: 'split', id: clip, at: number(-1, 14) };
      case 1:
        return { type: 'trim', id: clip, ...(next() > 0.5 ? { from: number(-2, 14) } : { to: number(-2, 14) }) };
      case 2:
        return { type: 'move-scene', id: pick(raw.scenes as { id: string }[]).id, index: Math.floor(number(-1, 6)) };
      case 3:
        return { type: 'speed', id: clip, speed: pick([0, 0.25, 1, 2, 12, 64, 100]) };
      case 4:
        return { type: 'shift', list: overlay, id: overlayId, by: number(-20, 20) };
      case 5:
        return list === 'scenes'
          ? { type: 'set', list, id, fields: { label: next() > 0.5 ? 'Renamed' : undefined } }
          : { type: 'set', list, id, fields: next() > 0.5 ? { rect } : { enabled: next() > 0.5 } };
      case 6:
        return overlay === 'zooms'
          ? { type: 'add', list: 'zooms', item: { at: number(-1, 13), duration: number(-1, 6), rect } }
          : overlay === 'masks'
            ? { type: 'add', list: 'masks', item: { from: number(-1, 13), to: number(-1, 14), rect } }
            : { type: 'add', list: 'texts', item: { at: number(-1, 13), duration: number(0, 4), text: 'Added' } };
      case 7:
        return { type: 'delete', list, id };
      case 8:
        return { type: 'duplicate', list, id, shift: number(-3, 3) };
      case 9:
        return pick<Command>([
          { type: 'look', path: ['frame', 'radius'], value: Math.floor(number(-10, 60)) },
          { type: 'look', path: ['background'], value: { preset: 'solid', color: '#123456' } },
          { type: 'look', path: ['transition', 'enabled'], value: next() > 0.5 },
        ]);
      default:
        return pick<Command>([
          { type: 'output', width: 1080, height: 1920 },
          { type: 'output', width: 1920, height: 1080 },
          { type: 'add', list: 'scenes', index: Math.floor(number(0, 4)), item: { type: 'card', title: 'Card', duration: number(-1, 5) } },
        ]);
    }
  }

  it('always leave a project that parses, refuse with a DocumentError, and never change the version they start from', () => {
    let applied = 0;
    for (let run = 1; run <= 150; run++) {
      const next = random(run);
      let raw = ensureIds(base);
      const versions: string[] = [JSON.stringify(raw)];
      for (let step = 0; step < 30; step++) {
        const edit = command(raw, next);
        const before = JSON.stringify(raw);
        let after: Raw;
        try {
          after = applyCommand(raw, edit, limits);
        } catch (error) {
          expect(error, JSON.stringify(edit)).toBeInstanceOf(DocumentError);
          expect(JSON.stringify(raw)).toBe(before);
          continue;
        }
        expect(JSON.stringify(raw), JSON.stringify(edit)).toBe(before);
        const parsed = parseProject(after);
        expect(parsed.ok, `${JSON.stringify(edit)}\n${JSON.stringify(parsed.ok ? '' : parsed.issues)}`).toBe(true);
        raw = after;
        versions.push(JSON.stringify(raw));
        applied++;
      }
      // Undo keeps whole versions: going back through them gives each one byte for byte, and each parses.
      for (const version of versions.reverse()) expect(parseProject(JSON.parse(version)).ok).toBe(true);
    }
    // the sequences do edit (not only refusals)
    expect(applied).toBeGreaterThan(1500);
  });
});

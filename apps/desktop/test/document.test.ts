import { describe, expect, it } from 'vitest';
import { parseProject } from '@cuttle/project';
import { applyCommand, clampRect, describeChange, DocumentError, ensureIds, firstChanged, pinIds, replayCommands, type Command, type Raw } from '../src/shared/document';
import { adjustRect, dragRange, drawnRect, fitInside, movePath, overlayRange, rangeFields, snapTime, toSource, toStage } from '../src/shared/edit';

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

  it('edits motion overlays as the other overlays: ids, a shift, a drag, their params, and the speed of their clip', () => {
    const raw = ensureIds({ ...base, overlays: [{ src: 'motion/bar/index.html', at: 4, duration: 2 }] });
    expect((raw.overlays as { id: string }[])[0]!.id).toBe('o1');
    let next = applyCommand(raw, { type: 'shift', list: 'overlays', id: 'o1', by: 1 }, limits);
    expect((next.overlays as { at: number }[])[0]!.at).toBe(5);
    next = applyCommand(next, { type: 'set', list: 'overlays', id: 'o1', fields: { ...rangeFields('overlays', 4, 5), params: { name: 'Lena' } } }, limits);
    expect(next.overlays).toEqual([{ src: 'motion/bar/index.html', at: 4, duration: 1, id: 'o1', params: { name: 'Lena' } }]);
    expect(describeChange(project(raw), project(next))).toBe('1 motion overlay changed');
    expect(firstChanged(project(raw), project(next))).toEqual({ list: 'overlays', id: 'o1' });
    // inside the 4× clip (3–8 s): 2 source s are 0.5 s of video, and stay so at 8×
    const faster = applyCommand(raw, { type: 'speed', id: 's2', speed: 8 }, limits);
    expect((faster.overlays as { duration: number }[])[0]!.duration).toBe(4);
  });

  it('edits sounds as overlays of a moment: ids, a shift, a drag that sets only their moment, a copy, their level kept in 0–1', () => {
    const raw = ensureIds({ ...base, sounds: [{ sound: 'whoosh', at: 4 }, { sound: 'pop', at: 0.5, scene: 's3' }] });
    expect((raw.sounds as { id: string }[]).map((sound) => sound.id)).toEqual(['a1', 'a2']);
    let next = applyCommand(raw, { type: 'shift', list: 'sounds', id: 'a1', by: -5 }, limits);
    expect((next.sounds as { at: number }[])[0]!.at).toBe(0);
    next = applyCommand(next, { type: 'set', list: 'sounds', id: 'a1', fields: { ...rangeFields('sounds', 4.5, 4.5), volume: 1.4 } }, limits);
    expect((next.sounds as unknown[])[0]).toEqual({ sound: 'whoosh', at: 4.5, id: 'a1', volume: 1 });
    next = applyCommand(next, { type: 'duplicate', list: 'sounds', id: 'a2', shift: 0.25 }, limits);
    expect((next.sounds as { id: string; at: number; scene?: string }[]).map((sound) => [sound.id, sound.at, sound.scene])).toEqual([
      ['a1', 4.5, undefined],
      ['a2', 0.5, 's3'],
      ['a3', 0.75, 's3'],
    ]);
    expect(describeChange(project(raw), project(next))).toBe('1 sound added · 1 sound changed');
    expect(firstChanged(project(raw), project(next))).toEqual({ list: 'sounds', id: 'a1' });
    // a scene takes its sounds along
    const without = applyCommand(raw, { type: 'delete', list: 'scenes', id: 's3' }, limits);
    expect((without.sounds as { id: string }[]).map((sound) => sound.id)).toEqual(['a1']);
    expect(describeChange(project(raw), project(without))).toBe('1 scene removed · 1 sound removed');
  });

  it('sets the music: fields merged, levels kept in range, and removed', () => {
    let next = applyCommand(base, { type: 'music', fields: { src: 'music/pulse/index.html' } }, limits);
    expect(next.music).toEqual({ src: 'music/pulse/index.html' });
    expect(describeChange(project(base), project(next))).toBe('music added');
    next = applyCommand(next, { type: 'music', fields: { volume: 1.7, duck: 99, params: { bpm: 118 } } }, limits);
    expect(next.music).toEqual({ src: 'music/pulse/index.html', volume: 1, duck: 40, params: { bpm: 118 } });
    const off = applyCommand(next, { type: 'music', fields: { enabled: false, params: undefined } }, limits);
    expect(off.music).toEqual({ src: 'music/pulse/index.html', volume: 1, duck: 40, enabled: false });
    expect(describeChange(project(next), project(off))).toBe('the music changed');
    const gone = applyCommand(off, { type: 'music', fields: null }, limits);
    expect(gone.music).toBeUndefined();
    expect(describeChange(project(off), project(gone))).toBe('the music removed');
    // a music without its page does not parse
    expect(() => applyCommand(base, { type: 'music', fields: { volume: 0.5 } }, limits)).toThrow(DocumentError);
  });

  it('sets the theme: fields merged and removed, or replaced as a whole (a brand kit)', () => {
    let next = applyCommand(base, { type: 'theme', fields: { name: 'Acme', accent: '#3366FF' } }, limits);
    expect(next.theme).toEqual({ name: 'Acme', accent: '#3366FF' });
    expect(describeChange(project(base), project(next))).toBe('the brand changed');
    next = applyCommand(next, { type: 'theme', fields: { accent: undefined, font: 'Bebas Neue' } }, limits);
    expect(next.theme).toEqual({ name: 'Acme', font: 'Bebas Neue' });
    const kit = applyCommand(next, { type: 'theme', fields: { url: 'acme.dev', kit: 'Acme', logo: undefined }, replace: true }, limits);
    expect(kit.theme).toEqual({ url: 'acme.dev', kit: 'Acme' });
    expect(() => applyCommand(base, { type: 'theme', fields: { font: 'Comic Sans' } }, limits)).toThrow(DocumentError);
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
    // 150 sequences take seconds; beside the other test files more than the default 5
  }, 30_000);
});

describe('automatic items in the document', () => {
  const tagged: Raw = {
    ...base,
    zooms: [{ id: 'z1', at: 4, duration: 2, rect: [0, 0, 640, 360], auto: 'click' }],
    cuts: [{ id: 'c1', label: 'Filler: ähm', from: 1, to: 1.4, auto: 'filler' }],
  };

  it('keeps the tag when an item is only switched off or on, and drops it on any other hand edit', () => {
    const off = applyCommand(tagged, { type: 'set', list: 'zooms', id: 'z1', fields: { enabled: false } }, limits);
    expect((off.zooms as Raw[])[0]).toMatchObject({ enabled: false, auto: 'click' });
    const moved = applyCommand(tagged, { type: 'shift', list: 'zooms', id: 'z1', by: 0.5 }, limits);
    expect((moved.zooms as Raw[])[0]!.auto).toBeUndefined();
    const resized = applyCommand(tagged, { type: 'set', list: 'zooms', id: 'z1', fields: { rect: [0, 0, 320, 180] } }, limits);
    expect((resized.zooms as Raw[])[0]!.auto).toBeUndefined();
    const longer = applyCommand(tagged, { type: 'set', list: 'cuts', id: 'c1', fields: { to: 1.6 } }, limits);
    expect((longer.cuts as Raw[])[0]).toMatchObject({ to: 1.6 });
    expect((longer.cuts as Raw[])[0]!.auto).toBeUndefined();
    const copy = applyCommand(tagged, { type: 'duplicate', list: 'zooms', id: 'z1', shift: 1 }, limits);
    expect((copy.zooms as Raw[]).map((zoom) => zoom.auto)).toEqual(['click', undefined]);
  });

  it('gives cuts ids, switches kinds of automatic edits, and says what changed', () => {
    const named = ensureIds({ ...base, cuts: [{ from: 1, to: 2 }] });
    expect((named.cuts as { id: string }[])[0]!.id).toBe('c1');
    const switched = applyCommand(tagged, { type: 'auto-edits', kind: 'fillers', value: false }, limits);
    expect(switched.autoEdits).toEqual({ fillers: false });
    expect(describeChange(project(tagged), project(switched))).toBe('the automatic edits changed');
    const cut = applyCommand(tagged, { type: 'add', list: 'cuts', item: { from: 5, to: 6 } }, limits);
    expect(describeChange(project(tagged), project(cut))).toBe('1 cut added');
  });
});

describe('a zoom that follows, in the document', () => {
  // the typing zoom 4–8 s in the 4× clip (3–8 s): from the left, to the middle at 5 s, to the right at 7 s
  const following: Raw = {
    ...base,
    scenes: [{ type: 'clip', id: 's1', from: 0, to: 12 }],
    zooms: [{ id: 'z1', at: 4, duration: 4, rect: [0, 200, 640, 400], moves: [{ at: 5, rect: [300, 200, 640, 400] }, { at: 7, rect: [600, 200, 640, 400] }], auto: 'typing' }],
  };
  const zoom = (raw: Raw) => (raw.zooms as Raw[])[0]!;

  it('takes its path along when it moves as a whole, by a drag, the inspector, a shift or a copy', () => {
    const dragged = applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { at: 5, duration: 4 } }, limits);
    expect(zoom(dragged)).toMatchObject({ at: 5, rect: [0, 200, 640, 400], moves: [{ at: 6 }, { at: 8 }] });
    expect(zoom(dragged).auto).toBeUndefined();
    expect(zoom(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { at: 3.5 } }, limits)).moves).toMatchObject([{ at: 4.5 }, { at: 6.5 }]);
    expect(zoom(applyCommand(following, { type: 'shift', list: 'zooms', id: 'z1', by: -0.25 }, limits)).moves).toMatchObject([{ at: 4.75 }, { at: 6.75 }]);
    const copied = applyCommand(following, { type: 'duplicate', list: 'zooms', id: 'z1', shift: 4 }, limits);
    expect((copied.zooms as Raw[])[1]).toMatchObject({ at: 8, moves: [{ at: 9 }, { at: 11 }] });
  });

  it('keeps its path in the take when an edge moves: what falls outside goes, a later start starts where the path was', () => {
    const later = zoom(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { at: 5.5, duration: 2.5 } }, limits));
    expect(later).toMatchObject({ at: 5.5, rect: [300, 200, 640, 400], moves: [{ at: 7, rect: [600, 200, 640, 400] }] });
    const shorter = zoom(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { duration: 2.5 } }, limits));
    expect(shorter.moves).toEqual([{ at: 5, rect: [300, 200, 640, 400] }]);
    const none = zoom(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { duration: 0.5 } }, limits));
    expect(none).not.toHaveProperty('moves');
  });

  it('stretches its path with its clip\'s speed when made by hand, holds still on request, and keeps its moves on the screen', () => {
    const long = { ...following, scenes: [{ type: 'clip', id: 's1', from: 0, to: 20 }] };
    const sped = applyCommand({ ...long, zooms: [{ ...zoom(following), auto: undefined }] }, { type: 'speed', id: 's1', speed: 2 }, limits);
    expect(zoom(sped)).toMatchObject({ at: 4, duration: 8, moves: [{ at: 6 }, { at: 10 }] });
    // made by suggest: it stays on the typing it follows
    expect(zoom(applyCommand(long, { type: 'speed', id: 's1', speed: 2 }, limits))).toEqual(zoom(following));
    const still = zoom(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { moves: undefined } }, limits));
    expect(still).not.toHaveProperty('moves');
    expect(still.auto).toBeUndefined();
    const off = zoom(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { moves: [{ at: 5, rect: [1000, 700, 640, 400] }] } }, limits));
    expect(off.moves).toEqual([{ at: 5, rect: [1000, 700, 280, 100] }]);
    expect(project(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { at: 0.5 } }, limits)).zooms[0]!.moves).toHaveLength(2);
  });

  it('keeps a mask\'s path with its time too: a drag or a shift takes it along, an edge leaves it in the take', () => {
    const scrolling: Raw = {
      ...following,
      masks: [{ id: 'm1', from: 2, to: 8, rect: [10, 400, 300, 30], moves: [{ at: 4, rect: [10, 300, 300, 30] }, { at: 6, rect: [10, 200, 300, 30] }], auto: 'privacy' }],
    };
    const mask = (raw: Raw) => (raw.masks as Raw[])[0]!;
    expect(mask(applyCommand(scrolling, { type: 'set', list: 'masks', id: 'm1', fields: { from: 3, to: 9 } }, limits))).toMatchObject({ from: 3, moves: [{ at: 5 }, { at: 7 }] });
    expect(mask(applyCommand(scrolling, { type: 'shift', list: 'masks', id: 'm1', by: 1 }, limits)).moves).toMatchObject([{ at: 5 }, { at: 7 }]);
    expect(mask(applyCommand(scrolling, { type: 'set', list: 'masks', id: 'm1', fields: { from: 5 } }, limits))).toMatchObject({ from: 5, rect: [10, 300, 300, 30], moves: [{ at: 6 }] });
    expect(mask(applyCommand(scrolling, { type: 'set', list: 'masks', id: 'm1', fields: { moves: undefined } }, limits))).not.toHaveProperty('moves');
  });

  it('moves and scales the whole path the way the box at the playhead was dragged', () => {
    const path = { rect: [0, 200, 640, 400] as [number, number, number, number], moves: [{ at: 5, rect: [300, 200, 640, 400] as [number, number, number, number] }] };
    // the box at the playhead (on the move) went 100 px right and 50 px down
    expect(movePath(path, [300, 200, 640, 400], [400, 250, 640, 400])).toEqual({ rect: [100, 250, 640, 400], moves: [{ at: 5, rect: [400, 250, 640, 400] }] });
    // and half as big from its corner
    expect(movePath(path, [300, 200, 640, 400], [300, 200, 320, 200])).toEqual({ rect: [150, 200, 320, 200], moves: [{ at: 5, rect: [300, 200, 320, 200] }] });
  });
});

describe('captions in the document', () => {
  it('sets their fields, and fixes words: a fix takes the place of those it overlaps, and none leaves no list', () => {
    const styled = applyCommand(base, { type: 'captions', field: 'style', value: 'karaoke' }, limits);
    expect(styled.captions).toEqual({ style: 'karaoke' });
    expect(describeChange(project(base), project(styled))).toBe('the subtitles changed');
    const fixed = applyCommand(styled, { type: 'caption-fix', at: 3.1, end: 3.6, text: 'Holofish' }, limits);
    const again = applyCommand(fixed, { type: 'caption-fix', at: 3.4, end: 4, text: 'Holofish App' }, limits);
    expect((again.captions as Raw).fixes).toEqual([{ at: 3.4, end: 4, text: 'Holofish App' }]);
    const both = applyCommand(fixed, { type: 'caption-fix', at: 1, end: 1.2, text: '' }, limits);
    expect((both.captions as Raw).fixes).toEqual([{ at: 1, end: 1.2, text: '' }, { at: 3.1, end: 3.6, text: 'Holofish' }]);
    const undone = applyCommand(fixed, { type: 'caption-fix', at: 3, end: 3.2, text: undefined }, limits);
    expect(undone.captions).toEqual({ style: 'karaoke' });
    expect(() => applyCommand(base, { type: 'caption-fix', at: 2, end: 2, text: 'x' }, limits)).toThrow(DocumentError);
  });

  it('says that a take was transcribed, not that it is another take', () => {
    const transcribed = { ...base, sources: { ...(base.sources as Raw), transcript: 'takes/1/transcript.json' } };
    expect(describeChange(project(base), project(transcribed))).toBe('the take was transcribed');
  });
});

import { describe, expect, it, vi } from 'vitest';

// The renderer's document with a main process that takes a while for each write: an undo comes in
// while the write of the one before still runs.
const written: unknown[] = [];
let writes = 0;
vi.mock('../src/renderer/bridge', () => ({
  bridge: {
    invoke: (channel: string, argument: { raw: unknown }) => {
      if (channel !== 'project:save') return Promise.resolve(undefined);
      return new Promise((resolve) =>
        setTimeout(() => {
          written.push(argument.raw);
          resolve({ hash: String(++writes).padStart(64, '0') });
        }, 30),
      );
    },
    on: () => () => {},
  },
}));
vi.mock('../src/renderer/editor/session', async () => {
  const { createStore } = await import('../src/renderer/editor/store');
  return { store: createStore<{ doc?: unknown }>({}) };
});

const { edit, flush, openDocument, undo } = await import('../src/renderer/editor/doc');
const { store } = await import('../src/renderer/editor/session');

const raw = {
  version: 1,
  sources: { screen: 'takes/1/screen.mp4' },
  scenes: [{ type: 'clip', id: 's1', from: 0, to: 8 }],
};
const limits = { sourceEnd: 8, screen: { width: 1280, height: 800 }, fps: 30 };
const zoom = (at: number) => ({ type: 'add' as const, list: 'zooms' as const, item: { at, duration: 1, rect: [0, 0, 640, 400] } });

describe('the editor document', () => {
  it('writes every undo, also one pressed while the write before it still runs', async () => {
    store.set({ doc: openDocument(raw, '0'.repeat(64), () => limits) });
    edit([zoom(1)], 'Draw zoom');
    edit([zoom(3)], 'Draw zoom');
    expect(await flush()).toBe(true);
    // two undos at once: the second comes while the first one's write runs
    undo();
    undo();
    expect(await flush()).toBe(true);
    const doc = (store.get() as { doc: { raw: { zooms?: unknown[] } } }).doc;
    expect(doc.raw.zooms ?? []).toEqual([]);
    expect((written.at(-1) as { zooms?: unknown[] }).zooms ?? []).toEqual([]);
  });
});

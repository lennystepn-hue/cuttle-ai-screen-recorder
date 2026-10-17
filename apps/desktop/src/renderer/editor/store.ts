// A tiny store: one state object, replaced on every change, read with useSyncExternalStore.
import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(change: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(change) {
      const next = typeof change === 'function' ? change(state) : change;
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The part of the store's state `select` picks; the component re-renders when it changes (by `Object.is`). */
export function useStore<T, S>(store: Store<T>, select: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

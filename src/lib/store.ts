// Tiny observable store with a React hook and optional localStorage persistence.

import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      const v = typeof next === 'function' ? (next as (p: T) => T)(value) : next;
      if (Object.is(v, value)) return;
      value = v;
      subs.forEach((f) => f());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function readLocal(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: keep running in memory */
  }
}

/** Loads the store from localStorage (through `sanitize`) and saves every change. */
export function persist<T>(store: Store<T>, key: string, sanitize: (raw: unknown) => T, pick: (v: T) => unknown = (v) => v): void {
  if (typeof localStorage === 'undefined') return;
  const raw = readLocal(key);
  if (raw !== undefined) store.set(sanitize(raw));
  let t: ReturnType<typeof setTimeout> | undefined;
  store.subscribe(() => {
    clearTimeout(t);
    t = setTimeout(() => writeLocal(key, pick(store.get())), 150);
  });
}

// Rhythm files are downloaded whole into the Cache API the first time they
// are played (or on request), so they keep working without internet.

import { createStore } from '../lib/store';
import type { Rhythm } from './rhythms';

const CACHE = 'ritim-mp3-v1';

/** Ids of rhythms stored on this device. */
export const offline = createStore<Set<string>>(new Set());

const hasCache = (): boolean => typeof caches !== 'undefined';

export async function refreshOffline(all: readonly Rhythm[]): Promise<void> {
  if (!hasCache()) return;
  const c = await caches.open(CACHE);
  const keys = new Set((await c.keys()).map((k) => new URL(k.url).pathname));
  offline.set(new Set(all.filter((r) => keys.has(new URL(r.file, location.href).pathname)).map((r) => r.id)));
}

const inflight = new Map<string, { promise: Promise<Blob>; listeners: Set<(f: number) => void> }>();

/** The rhythm file as a Blob: from the device when stored, else downloaded (and stored). */
export function getRhythmBlob(r: Rhythm, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Blob> {
  const running = inflight.get(r.id);
  if (running) {
    if (onProgress) running.listeners.add(onProgress);
    return running.promise;
  }
  const listeners = new Set<(f: number) => void>(onProgress ? [onProgress] : []);
  const promise = fetchBlob(r, (f) => listeners.forEach((l) => l(f)), signal).finally(() => inflight.delete(r.id));
  inflight.set(r.id, { promise, listeners });
  return promise;
}

async function fetchBlob(r: Rhythm, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<Blob> {
  const url = new URL(r.file, location.href).href;
  const c = hasCache() ? await caches.open(CACHE) : undefined;
  const hit = await c?.match(url);
  if (hit) return hit.blob();
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`İndirilemedi (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || r.size;
  let blob: Blob;
  if (res.body) {
    const reader = res.body.getReader();
    const parts: BlobPart[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress(Math.min(1, got / total));
    }
    blob = new Blob(parts, { type: 'audio/mpeg' });
  } else blob = await res.blob();
  if (c) {
    try {
      await c.put(url, new Response(blob, { headers: { 'content-type': 'audio/mpeg', 'content-length': String(blob.size) } }));
      offline.set((s) => new Set(s).add(r.id));
    } catch {
      /* storage full: play without keeping it */
    }
  }
  return blob;
}

/** Downloads several rhythms; reports how many are done. */
export async function downloadAll(list: readonly Rhythm[], onStep: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  const todo = list.filter((r) => !offline.get().has(r.id));
  let done = 0;
  onStep(0, todo.length);
  for (const r of todo) {
    if (signal?.aborted) return;
    await getRhythmBlob(r, undefined, signal);
    onStep(++done, todo.length);
  }
}

export async function clearOffline(): Promise<void> {
  if (hasCache()) await caches.delete(CACHE);
  offline.set(new Set());
}

export const offlineBytes = (all: readonly Rhythm[]): number =>
  all.filter((r) => offline.get().has(r.id)).reduce((a, r) => a + r.size, 0);

export const formatMB = (bytes: number): string => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;

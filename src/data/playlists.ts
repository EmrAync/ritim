// User playlists: song names with the rhythm (and tempo) to play them with.
// Stored on the device; a list can be shared as a file or as a link.

import { createStore, persist } from '../lib/store';

export interface ListEntry {
  id: string;
  song: string;
  rhythmId: string;
  /** Tempo to play this song at; the rhythm's own tempo when missing. */
  bpm?: number;
}

export interface Playlist {
  id: string;
  name: string;
  entries: ListEntry[];
}

export const MAX_LISTS = 200;
export const MAX_ENTRIES = 500;
const MAX_TEXT = 120;

export const newId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const text = (v: unknown, max = MAX_TEXT): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const bpmOf = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 20 && v <= 400 ? Math.round(v) : undefined;

export function sanitizeEntry(raw: unknown): ListEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const rhythmId = text(r.rhythmId, 200);
  const song = text(r.song);
  if (!rhythmId || !song) return undefined;
  const e: ListEntry = { id: text(r.id, 40) || newId(), song, rhythmId };
  const bpm = bpmOf(r.bpm);
  if (bpm) e.bpm = bpm;
  return e;
}

export function sanitizeList(raw: unknown): Playlist | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const name = text(r.name);
  if (!name) return undefined;
  const entries = (Array.isArray(r.entries) ? r.entries : [])
    .slice(0, MAX_ENTRIES)
    .map(sanitizeEntry)
    .filter((e): e is ListEntry => !!e);
  // Ids must be unique inside a list (imported files may repeat them).
  const ids = new Set<string>();
  for (const e of entries) {
    if (ids.has(e.id)) e.id = newId();
    ids.add(e.id);
  }
  return { id: text(r.id, 40) || newId(), name, entries };
}

export function sanitizeLists(raw: unknown): Playlist[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_LISTS)
    .map(sanitizeList)
    .filter((l): l is Playlist => !!l);
}

export const playlists = createStore<Playlist[]>([]);
persist(playlists, 'ritim.lists.v1', sanitizeLists);

const update = (id: string, fn: (l: Playlist) => Playlist): void =>
  playlists.set((all) => all.map((l) => (l.id === id ? fn(l) : l)));

export const listById = (id: string | undefined): Playlist | undefined => playlists.get().find((l) => l.id === id);

export function createList(name: string): Playlist {
  const l: Playlist = { id: newId(), name: text(name) || 'Yeni liste', entries: [] };
  playlists.set((all) => [...all, l]);
  return l;
}

export const renameList = (id: string, name: string): void => {
  const n = text(name);
  if (n) update(id, (l) => ({ ...l, name: n }));
};

export const deleteList = (id: string): void => playlists.set((all) => all.filter((l) => l.id !== id));

export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return [...arr];
  const out = [...arr];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

export const moveList = (from: number, to: number): void => playlists.set((all) => moveItem(all, from, to));

export function addEntry(listId: string, e: Omit<ListEntry, 'id'>): ListEntry | undefined {
  const entry = sanitizeEntry({ ...e, id: newId() });
  if (entry) update(listId, (l) => ({ ...l, entries: [...l.entries, entry].slice(0, MAX_ENTRIES) }));
  return entry;
}

export function updateEntry(listId: string, entryId: string, patch: Partial<Omit<ListEntry, 'id'>>): void {
  update(listId, (l) => ({
    ...l,
    entries: l.entries.map((e) => (e.id === entryId ? (sanitizeEntry({ ...e, ...patch, id: e.id, bpm: 'bpm' in patch ? patch.bpm : e.bpm }) ?? e) : e)),
  }));
}

export const deleteEntry = (listId: string, entryId: string): void =>
  update(listId, (l) => ({ ...l, entries: l.entries.filter((e) => e.id !== entryId) }));

export const moveEntry = (listId: string, from: number, to: number): void =>
  update(listId, (l) => ({ ...l, entries: moveItem(l.entries, from, to) }));

// ---- sharing ----

export interface ListFile {
  type: 'ritim-listesi';
  version: 1;
  name: string;
  entries: { song: string; rhythmId: string; bpm?: number }[];
}

export const toFile = (l: Playlist): ListFile => ({
  type: 'ritim-listesi',
  version: 1,
  name: l.name,
  entries: l.entries.map(({ song, rhythmId, bpm }) => (bpm ? { song, rhythmId, bpm } : { song, rhythmId })),
});

/** A list read from a shared file/link (new ids, not yet saved). */
export function fromFile(raw: unknown): Playlist | undefined {
  if (!raw || typeof raw !== 'object' || (raw as { type?: unknown }).type !== 'ritim-listesi') return undefined;
  const l = sanitizeList({ ...(raw as object), id: newId() });
  if (l) l.entries = l.entries.map((e) => ({ ...e, id: newId() }));
  return l;
}

/** Saves an imported list; renames it when the name is taken. */
export function importList(l: Playlist): Playlist {
  const names = new Set(playlists.get().map((x) => x.name));
  let name = l.name;
  for (let i = 2; names.has(name); i++) name = `${l.name} (${i})`;
  const saved = { ...l, id: newId(), name };
  playlists.set((all) => [...all, saved].slice(-MAX_LISTS));
  return saved;
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Compact link payload: [name, [[song, rhythmId, bpm?], ...]]. */
export function encodeListLink(l: Playlist): string {
  const data = [l.name, l.entries.map((e) => (e.bpm ? [e.song, e.rhythmId, e.bpm] : [e.song, e.rhythmId]))];
  return toBase64Url(JSON.stringify(data));
}

export function decodeListLink(code: string): Playlist | undefined {
  try {
    const data = JSON.parse(fromBase64Url(code)) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[1])) return undefined;
    const entries = (data[1] as unknown[]).map((e) =>
      Array.isArray(e) ? { song: e[0], rhythmId: e[1], bpm: e[2] } : undefined,
    );
    return fromFile({ type: 'ritim-listesi', version: 1, name: data[0], entries });
  } catch {
    return undefined;
  }
}

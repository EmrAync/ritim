// Sharing playlists: as a link (list inside the URL) or as a .json file.

import { encodeListLink, decodeListLink, fromFile, toFile, type Playlist } from '../data/playlists';
import { createStore } from '../lib/store';
import { toast } from './common';

/** A list received by link or file, waiting for the user to accept it. */
export const pendingImport = createStore<Playlist | undefined>(undefined);

export const listLink = (l: Playlist): string => `${location.origin}${location.pathname}#liste=${encodeListLink(l)}`;

export async function shareLink(l: Playlist): Promise<void> {
  const url = listLink(l);
  try {
    if (navigator.share) {
      await navigator.share({ title: l.name, text: `“${l.name}” ritim listesi`, url });
      return;
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link kopyalandı');
  } catch {
    window.prompt('Linki kopyalayın:', url);
  }
}

const fileName = (l: Playlist): string => `${l.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'liste'}.ritim.json`;

export async function shareFile(l: Playlist): Promise<void> {
  const json = JSON.stringify(toFile(l), null, 1);
  const file = new File([json], fileName(l), { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: l.name });
      return;
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function readListFile(f: File): Promise<void> {
  try {
    if (f.size > 2_000_000) throw new Error('too big');
    const l = fromFile(JSON.parse(await f.text()));
    if (!l) throw new Error('not a list');
    pendingImport.set(l);
  } catch {
    toast('Bu dosya bir ritim listesi değil');
  }
}

/** Opens a list shared by link (#liste=…) and clears it from the address. */
export function checkLinkImport(): void {
  const m = /[#&]liste=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!m) return;
  history.replaceState(history.state, '', location.pathname + location.search);
  const l = decodeListLink(m[1]);
  if (l) pendingImport.set(l);
  else toast('Paylaşılan liste okunamadı');
}

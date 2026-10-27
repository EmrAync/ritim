// Rhythm player: one looping <audio> element routed through Web Audio (for
// volume and fades, which iOS ignores on the element itself). Tempo changes
// use the browser's pitch-preserving playbackRate; files are played from a
// downloaded Blob so they also work offline.

import { getRhythmBlob } from '../data/offline';
import { listById } from '../data/playlists';
import { catalog, rhythmById, type Rhythm } from '../data/rhythms';
import { createStore, persist, readLocal, writeLocal } from '../lib/store';
import { masterOut, unlockAudio } from './context';
import { clamp, rateFor, tempoRange } from './tempo';

export interface QueueRef {
  listId: string;
  index: number;
}

export interface PlayerState {
  rhythmId?: string;
  bpm: number;
  playing: boolean;
  loading: boolean;
  loadPct: number;
  error?: string;
  /** Stop after this many minutes (0 = unlimited). */
  timerMin: number;
  /** Date.now() when the timer stops the rhythm. */
  endsAt?: number;
  fading: boolean;
  volume: number;
  /** Playing from a playlist: prev/next move inside it. */
  queue?: QueueRef;
}

export interface Progress {
  pos: number;
  dur: number;
  loops: number;
}

export const TIMER_FADE_S = 8;
export const TIMER_CHOICES = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];

export const player = createStore<PlayerState>({ bpm: 100, playing: false, loading: false, loadPct: 0, timerMin: 0, fading: false, volume: 1 });
export const progress = createStore<Progress>({ pos: 0, dur: 0, loops: 0 });

persist(
  player,
  'ritim.player.v1',
  (raw) => {
    const r = (raw ?? {}) as Partial<PlayerState>;
    const q = r.queue && typeof r.queue.listId === 'string' && Number.isInteger(r.queue.index) ? r.queue : undefined;
    return {
      ...player.get(),
      rhythmId: typeof r.rhythmId === 'string' ? r.rhythmId : undefined,
      bpm: typeof r.bpm === 'number' ? clamp(Math.round(r.bpm), 20, 400) : 100,
      timerMin: TIMER_CHOICES.includes(r.timerMin as number) ? (r.timerMin as number) : 0,
      volume: typeof r.volume === 'number' ? clamp(r.volume, 0, 1) : 1,
      queue: q,
    };
  },
  ({ rhythmId, bpm, timerMin, volume, queue }) => ({ rhythmId, bpm, timerMin, volume, queue }),
);

// Last tempo used per rhythm, so a rhythm comes back at the tempo it was left at.
const TEMPO_KEY = 'ritim.tempos.v1';
const tempos: Record<string, number> = (() => {
  const raw = readLocal(TEMPO_KEY);
  return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
})();

export const currentRhythm = (): Rhythm | undefined => rhythmById(player.get().rhythmId);

let audio: HTMLAudioElement | undefined;
let gain: GainNode | undefined;
let blobUrl: string | undefined;
let loadedId: string | undefined;
let primed = false;
let loadToken = 0;
let ticker: ReturnType<typeof setInterval> | undefined;
let lastPos = 0;
let wakeLock: { release(): Promise<void> } | undefined;

const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

function element(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.loop = true;
    audio.preload = 'auto';
    audio.setAttribute('playsinline', '');
    const a = audio as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean };
    a.preservesPitch = true;
    a.mozPreservesPitch = true;
    a.webkitPreservesPitch = true;
    audio.addEventListener('error', () => {
      if (audio?.src && audio.src !== SILENCE) player.set((s) => ({ ...s, error: 'Ses dosyası çalınamadı.' }));
    });
  }
  return audio;
}

function connect(): void {
  if (gain) return;
  const ctx = unlockAudio();
  const src = ctx.createMediaElementSource(element());
  gain = ctx.createGain();
  gain.gain.value = player.get().volume;
  src.connect(gain).connect(masterOut());
}

function applyRate(): void {
  if (!audio) return;
  const r = currentRhythm();
  audio.playbackRate = rateFor(r?.bpm, player.get().bpm);
}

async function load(r: Rhythm, token: number): Promise<boolean> {
  if (loadedId === r.id && blobUrl) return true;
  player.set((s) => ({ ...s, loading: true, loadPct: 0 }));
  const blob = await getRhythmBlob(r, (f) => {
    if (token === loadToken) player.set((s) => ({ ...s, loadPct: f }));
  });
  if (token !== loadToken) return false;
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(blob);
  loadedId = r.id;
  element().src = blobUrl;
  return true;
}

function setGain(v: number, seconds: number): void {
  if (!gain) return;
  const ctx = gain.context;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(v, t + Math.max(0.01, seconds));
}

async function requestWakeLock(): Promise<void> {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (wl && !wakeLock) wakeLock = await wl.request('screen');
  } catch {
    /* not supported or refused */
  }
}

function releaseWakeLock(): void {
  void wakeLock?.release().catch(() => undefined);
  wakeLock = undefined;
}

function tick(): void {
  const a = audio;
  if (!a) return;
  const pos = a.currentTime;
  const dur = Number.isFinite(a.duration) ? a.duration : currentRhythm()?.duration ?? 0;
  let loops = progress.get().loops;
  if (pos + 1 < lastPos) loops++;
  lastPos = pos;
  progress.set({ pos, dur, loops });
  const { endsAt, fading, playing } = player.get();
  if (!playing || !endsAt) return;
  const left = (endsAt - Date.now()) / 1000;
  if (left <= 0) stopRhythm(0.05);
  else if (left <= TIMER_FADE_S && !fading) {
    player.set((s) => ({ ...s, fading: true }));
    setGain(0, left);
  }
}

function updateMediaSession(): void {
  const ms = navigator.mediaSession;
  const r = currentRhythm();
  if (!ms || !r || typeof MediaMetadata === 'undefined') return;
  ms.metadata = new MediaMetadata({ title: r.title, artist: `${r.meter ?? ''} · ${player.get().bpm} BPM`, album: 'Ritim' });
}

/** Starts the selected rhythm from the loop start. Call from a tap. */
export function playRhythm(): void {
  const r = currentRhythm();
  if (!r) {
    player.set((s) => ({ ...s, error: 'Önce bir ritim seçin.' }));
    return;
  }
  // Synchronous part: inside the tap, so iOS lets this element and context play later.
  connect();
  const a = element();
  if (!primed) {
    primed = true;
    if (!a.src) {
      a.src = SILENCE;
      void a.play().catch(() => undefined);
    }
  }
  const token = ++loadToken;
  player.set((s) => ({ ...s, error: undefined }));
  void (async () => {
    try {
      if (!(await load(r, token))) return;
      a.currentTime = 0;
      lastPos = 0;
      progress.set({ pos: 0, dur: r.duration, loops: 0 });
      applyRate();
      setGain(player.get().volume, 0.02);
      await a.play();
      if (token !== loadToken) return;
      const { timerMin } = player.get();
      player.set((s) => ({ ...s, playing: true, loading: false, fading: false, endsAt: timerMin ? Date.now() + timerMin * 60000 : undefined }));
      clearInterval(ticker);
      ticker = setInterval(tick, 100);
      void requestWakeLock();
      updateMediaSession();
    } catch (e) {
      if (token !== loadToken) return;
      const msg = e instanceof Error && e.name === 'NotAllowedError' ? 'Başlatmak için START tuşuna tekrar dokunun.' : e instanceof Error ? e.message : String(e);
      player.set((s) => ({ ...s, playing: false, loading: false, error: msg }));
    }
  })();
}

/** Stops with a short fade (no click). */
export function stopRhythm(fade = 0.12): void {
  const token = ++loadToken;
  clearInterval(ticker);
  ticker = undefined;
  setGain(0, fade);
  setTimeout(() => {
    // Not restarted meanwhile: pause and restore the level for the next START.
    if (token !== loadToken) return;
    audio?.pause();
    setGain(player.get().volume, 0.01);
  }, fade * 1000 + 30);
  player.set((s) => ({ ...s, playing: false, loading: false, fading: false, endsAt: undefined }));
  releaseWakeLock();
}

export function toggleRhythm(): void {
  if (player.get().playing || player.get().loading) stopRhythm();
  else playRhythm();
}

export function setBpm(bpm: number): void {
  const r = currentRhythm();
  const [lo, hi] = tempoRange(r?.bpm);
  const v = clamp(Math.round(bpm), lo, hi);
  if (v === player.get().bpm) return;
  player.set((s) => ({ ...s, bpm: v }));
  if (r) {
    tempos[r.id] = v;
    writeLocal(TEMPO_KEY, tempos);
  }
}

export function setTimer(min: number): void {
  player.set((s) => ({ ...s, timerMin: min, endsAt: s.playing && min ? Date.now() + min * 60000 : undefined, fading: false }));
  if (player.get().playing) setGain(player.get().volume, 0.3);
}

export function setVolume(v: number): void {
  player.set((s) => ({ ...s, volume: clamp(v, 0, 1) }));
  if (!player.get().fading) setGain(player.get().volume, 0.05);
}

/** Picks a rhythm (from the library, or a playlist entry with its own tempo). */
export function selectRhythm(id: string, opts: { bpm?: number; queue?: QueueRef } = {}): void {
  const r = rhythmById(id);
  if (!r) return;
  const bpm = opts.bpm ?? tempos[id] ?? r.bpm ?? 100;
  const [lo, hi] = tempoRange(r.bpm);
  player.set((s) => ({ ...s, rhythmId: id, bpm: clamp(Math.round(bpm), lo, hi), queue: opts.queue, error: undefined }));
  if (player.get().playing || player.get().loading) playRhythm();
  // Download in the background so START plays at once.
  else void getRhythmBlob(r).catch(() => undefined);
  updateMediaSession();
}

export function selectEntry(listId: string, index: number): void {
  const l = listById(listId);
  const e = l?.entries[index];
  if (!e) return;
  selectRhythm(e.rhythmId, { bpm: e.bpm, queue: { listId, index } });
}

/** Previous/next rhythm: inside the playlist when playing from one, else the library order. */
export function stepRhythm(dir: 1 | -1): void {
  const { queue, rhythmId } = player.get();
  const l = queue && listById(queue.listId);
  if (l && l.entries.length) {
    const n = l.entries.length;
    selectEntry(l.id, (((queue!.index + dir) % n) + n) % n);
    return;
  }
  const all = catalog.get().rhythms;
  if (!all.length) return;
  const i = all.findIndex((r) => r.id === rhythmId);
  const next = all[(((i < 0 ? 0 : i + dir) % all.length) + all.length) % all.length];
  selectRhythm(next.id);
}

player.subscribe(applyRate);

if (typeof navigator !== 'undefined' && navigator.mediaSession) {
  const ms = navigator.mediaSession;
  try {
    ms.setActionHandler('play', () => playRhythm());
    ms.setActionHandler('pause', () => stopRhythm());
    ms.setActionHandler('stop', () => stopRhythm());
    ms.setActionHandler('nexttrack', () => stepRhythm(1));
    ms.setActionHandler('previoustrack', () => stepRhythm(-1));
  } catch {
    /* some actions unsupported */
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && player.get().playing) void requestWakeLock();
  });
}

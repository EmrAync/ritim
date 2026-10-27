// Rhythm player: plays the selected loop through Signalsmith Stretch
// (instant, smooth tempo changes; exact loop position for the metronome),
// or through <audio> where that is not available. Volume and fades go
// through a Web Audio gain. Files come from the device cache when stored.

import { getRhythmBlob } from '../data/offline';
import { listById } from '../data/playlists';
import { catalog, exactBpm, rhythmById, shownBpm, type Rhythm } from '../data/rhythms';
import { createStore, persist, readLocal, writeLocal } from '../lib/store';
import { audioContext, masterOut, unlockAudio } from './context';
import { ElementEngine, StretchEngine, stretchSupported, type RhythmEngine } from './engines';
import { clamp, rateFor, tempoRange } from './tempo';

export interface QueueRef {
  listId: string;
  index: number;
}

export interface PlayerState {
  rhythmId?: string;
  bpm: number;
  playing: boolean;
  /** Downloading or decoding the rhythm. */
  loading: boolean;
  loadPct: number;
  error?: string;
  /** Stop after this many minutes (0 = unlimited). */
  timerMin: number;
  /** Date.now() when the timer stops the rhythm. */
  endsAt?: number;
  fading: boolean;
  volume: number;
  /** Playing order: a playlist (prev/next move inside it) or, when unset, all rhythms. */
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

let gain: GainNode | undefined;
let element: ElementEngine | undefined;
let stretch: Promise<StretchEngine | undefined> | undefined;
let stretchBroken = !stretchSupported();
let active: RhythmEngine | undefined;
let token = 0;
let ticker: ReturnType<typeof setInterval> | undefined;
let lastPos = 0;
let appliedRate = 0;
let wakeLock: { release(): Promise<void> } | undefined;

const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

/** Audio graph; the first call must be inside a tap (iOS). */
function out(): GainNode {
  if (!gain) {
    const ctx = audioContext();
    gain = ctx.createGain();
    gain.gain.value = player.get().volume;
    gain.connect(masterOut());
  }
  return gain;
}

function elementEngine(): ElementEngine {
  if (!element) element = new ElementEngine(audioContext(), out());
  return element;
}

async function stretchEngine(): Promise<StretchEngine | undefined> {
  if (stretchBroken) return undefined;
  stretch ??= StretchEngine.create(audioContext(), out()).catch((e) => {
    console.warn('Signalsmith unavailable, using <audio>', e);
    stretchBroken = true;
    return undefined;
  });
  return stretch;
}

// The selected rhythm decoded ahead of START (decoding takes a second or more on a phone).
let pre: { id: string; buf: Promise<AudioBuffer | undefined> } | undefined;

/** Starts downloading and decoding a rhythm in the background. */
export function preload(r: Rhythm | undefined = currentRhythm()): void {
  if (!r) return;
  if (r.whole || stretchBroken) {
    void getRhythmBlob(r).catch(() => undefined);
    return;
  }
  if (pre?.id === r.id) return;
  pre = {
    id: r.id,
    buf: getRhythmBlob(r)
      .then(async (b) => audioContext().decodeAudioData(await b.arrayBuffer()))
      .catch(() => undefined),
  };
}

async function engineFor(r: Rhythm): Promise<RhythmEngine> {
  // Very long recordings would need too much memory decoded: stream them.
  if (!r.whole) {
    const s = await stretchEngine();
    if (s) return s;
  }
  return elementEngine();
}

const rateNow = (): number => rateFor(exactBpm(currentRhythm()), player.get().bpm);

/** Downloads and prepares a rhythm; returns its engine (undefined when superseded). */
async function prepare(r: Rhythm, my: number): Promise<RhythmEngine | undefined> {
  const blob = await getRhythmBlob(r, (f) => {
    if (my === token) player.set((s) => ({ ...s, loadPct: f }));
  });
  if (my !== token) return undefined;
  const engine = await engineFor(r);
  if (my !== token) return undefined;
  const decoded = engine.kind === 'stretch' && pre?.id === r.id ? await pre.buf : undefined;
  if (my !== token) return undefined;
  await engine.load(r, blob, decoded);
  if (pre?.id === r.id) pre = undefined;
  return my === token ? engine : undefined;
}

function setGain(v: number, seconds: number): void {
  if (!gain) return;
  const t = gain.context.currentTime;
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
  if (!active) return;
  const ctx = audioContext();
  const pos = active.posAt(ctx.currentTime) ?? 0;
  const dur = active.loopLen() || currentRhythm()?.duration || 0;
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
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
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
  // Synchronous part, inside the tap: unlock the context and the <audio> element (iOS).
  unlockAudio();
  out();
  const el = elementEngine();
  el.prime(SILENCE);
  const my = ++token;
  active?.stop();
  player.set((s) => ({ ...s, error: undefined, loading: true, loadPct: 0 }));
  void (async () => {
    try {
      const engine = await prepare(r, my);
      if (!engine) return;
      if (active && active !== engine) active.stop();
      active = engine;
      setGain(0, 0.01);
      appliedRate = rateNow();
      await engine.start(appliedRate);
      if (my !== token) return;
      setGain(player.get().volume, 0.03);
      lastPos = 0;
      progress.set({ pos: 0, dur: engine.loopLen() || r.duration, loops: 0 });
      const { timerMin } = player.get();
      player.set((s) => ({ ...s, playing: true, loading: false, fading: false, endsAt: timerMin ? Date.now() + timerMin * 60000 : undefined }));
      clearInterval(ticker);
      ticker = setInterval(tick, 100);
      void requestWakeLock();
      updateMediaSession();
    } catch (e) {
      if (my !== token) return;
      console.warn(e);
      const msg = e instanceof Error && e.name === 'NotAllowedError' ? 'Başlatmak için START tuşuna tekrar dokunun.' : 'Ritim çalınamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.';
      player.set((s) => ({ ...s, playing: false, loading: false, error: msg }));
    }
  })();
}

/** Stops with a short fade (no click). */
export function stopRhythm(fade = 0.12): void {
  const my = ++token;
  clearInterval(ticker);
  ticker = undefined;
  setGain(0, fade);
  const engine = active;
  setTimeout(() => {
    // Not restarted meanwhile: stop the engine and restore the level for the next START.
    if (my !== token) return;
    engine?.stop();
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
  const [lo, hi] = tempoRange(shownBpm(r));
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
  const bpm = opts.bpm ?? tempos[id] ?? shownBpm(r) ?? 100;
  const [lo, hi] = tempoRange(shownBpm(r));
  const playing = player.get().playing || player.get().loading;
  player.set((s) => ({ ...s, rhythmId: id, bpm: clamp(Math.round(bpm), lo, hi), queue: opts.queue, error: undefined }));
  if (playing) playRhythm();
  else {
    progress.set({ pos: 0, dur: r.duration, loops: 0 });
    // Download and decode in the background so START plays at once.
    preload(r);
  }
  updateMediaSession();
}

export function selectEntry(listId: string, index: number): void {
  const l = listById(listId);
  const e = l?.entries[index];
  if (!e) return;
  selectRhythm(e.rhythmId, { bpm: e.bpm, queue: { listId, index } });
}

/** Chooses what ◀ ▶ walk through: a playlist from its first song, or all rhythms. */
export function setOrder(listId: string | undefined): void {
  if (!listId) {
    player.set((s) => ({ ...s, queue: undefined }));
    return;
  }
  selectEntry(listId, 0);
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

export interface RhythmClock {
  /** Loop position heard at audio time t. */
  posAt(t: number): number;
  rateAt(t: number): number;
  nextChange(t: number): number | undefined;
  loopLen: number;
  /** Exact quarter-note tempo of the loop at rate 1. */
  bpm: number;
  /** Bar start in the loop (s). */
  phase: number;
  /** Sample-exact (Signalsmith) or estimated from <audio>. */
  exact: boolean;
}

/** The playing rhythm's clock, for a metronome locked to it. */
export function rhythmClock(): RhythmClock | undefined {
  const r = currentRhythm();
  const e = active;
  const bpm = exactBpm(r);
  if (!player.get().playing || !e || !r || !bpm || !e.loopLen()) return undefined;
  return {
    posAt: (t) => e.posAt(t) ?? 0,
    rateAt: (t) => e.rateAt(t),
    nextChange: (t) => e.nextChange(t),
    loopLen: e.loopLen(),
    bpm,
    phase: r.phase ?? 0,
    exact: e.kind === 'stretch',
  };
}

player.subscribe(() => {
  if (!active || !player.get().playing) return;
  const rate = rateNow();
  if (Math.abs(rate - appliedRate) < 1e-6) return;
  appliedRate = rate;
  active.setRate(rate);
});

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

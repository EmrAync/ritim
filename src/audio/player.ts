// Rhythm player: plays the selected loop through Signalsmith Stretch
// (instant, smooth tempo changes; exact loop position for the metronome),
// or through <audio> where that is not available. Volume and fades go
// through a Web Audio gain. Files come from the device cache when stored.

import { getRhythmBlob } from '../data/offline';
import { listById } from '../data/playlists';
import { catalog, exactBpm, rhythmById, shownBpm, type Rhythm } from '../data/rhythms';
import { createStore, persist, readLocal, writeLocal } from '../lib/store';
import { audioContext, holdAudio, masterOut, onAudioReset, recreateAudio, unlockAudio } from './context';
import { ElementEngine, StretchEngine, Superseded, decodeOne, stretchSupported, type RhythmEngine } from './engines';
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
  /** The phone took the sound away and it did not come back by itself: a tap is needed. */
  stalled?: boolean;
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
/** Output level meter for the watchdog (is the rhythm really sounding?). */
let meter: AnalyserNode | undefined;
let meterBuf: Float32Array | undefined;
let element: ElementEngine | undefined;
let stretch: Promise<StretchEngine | undefined> | undefined;
let stretchBroken = !stretchSupported();

/** "kaliteli": Signalsmith (smooth tempo, metronome lock); "hafif": <audio> for very weak phones. */
export type EngineMode = 'kaliteli' | 'hafif';
export const engineMode = createStore<EngineMode>('kaliteli');
persist(engineMode, 'ritim.engine.v1', (raw) => (raw === 'hafif' ? 'hafif' : 'kaliteli'));
const useStretch = (): boolean => !stretchBroken && engineMode.get() === 'kaliteli';

/** Switches the engine; a playing rhythm restarts with it (call from a tap). */
export function setEngineMode(m: EngineMode): void {
  if (m === engineMode.get()) return;
  engineMode.set(m);
  pre = undefined;
  if (player.get().playing) playRhythm();
}
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
    meter = ctx.createAnalyser();
    meter.fftSize = 512;
    meterBuf = new Float32Array(meter.fftSize);
    gain.connect(meter);
  }
  return gain;
}

// A new AudioContext (after the phone kept the old one stuck): every node is rebuilt.
onAudioReset(() => {
  gain = undefined;
  meter = undefined;
  element = undefined;
  stretch = undefined;
  active = undefined;
  pre = undefined;
});

function elementEngine(): ElementEngine {
  if (!element) element = new ElementEngine(audioContext(), out());
  return element;
}

async function stretchEngine(): Promise<StretchEngine | undefined> {
  if (stretchBroken) return undefined;
  stretch ??= StretchEngine.create(audioContext(), out())
    .then((e) => {
      // The worklet crashed (memory, CPU): carry on with <audio> from the same spot.
      e.onFail = () => {
        stretchBroken = true;
        stretch = undefined;
        if (player.get().playing && active === e) restartHere();
      };
      return e;
    })
    .catch((e) => {
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
  if (r.whole || !useStretch()) {
    void getRhythmBlob(r).catch(() => undefined);
    return;
  }
  if (pre?.id === r.id) return;
  const id = r.id;
  pre = {
    id,
    // Queued behind any running decode; skipped if another rhythm is chosen meanwhile.
    buf: getRhythmBlob(r)
      .then((b) => decodeOne(audioContext(), b, () => pre?.id === id))
      .catch(() => undefined),
  };
}

async function engineFor(r: Rhythm): Promise<RhythmEngine> {
  // Very long recordings would need too much memory decoded: stream them.
  if (!r.whole && useStretch()) {
    const s = await stretchEngine();
    if (s) return s;
  }
  return elementEngine();
}

const rateNow = (): number => rateFor(exactBpm(currentRhythm()), player.get().bpm);

/** Downloads and prepares a rhythm; returns its engine (undefined when superseded). */
/** Failure inside the tempo engine (not the download): worth retrying with <audio>. */
class EngineError extends Error {}

/** Download of the rhythm being prepared; aborted when another rhythm is chosen. */
let download: { id: string; ac: AbortController } | undefined;

async function prepare(r: Rhythm, my: number): Promise<RhythmEngine | undefined> {
  if (download && download.id !== r.id) download.ac.abort();
  const ac = download?.id === r.id ? download.ac : new AbortController();
  download = { id: r.id, ac };
  const blob = await getRhythmBlob(
    r,
    (f) => {
      if (my === token) player.set((s) => ({ ...s, loadPct: f }));
    },
    ac.signal,
  );
  if (my !== token) return undefined;
  const engine = await engineFor(r);
  if (my !== token) return undefined;
  const decoded = engine.kind === 'stretch' && pre?.id === r.id ? await pre.buf : undefined;
  if (my !== token) return undefined;
  try {
    await engine.load(r, blob, decoded);
  } catch (e) {
    if (e instanceof Superseded) return undefined;
    throw new EngineError(e instanceof Error ? e.message : String(e));
  }
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

// ---- watchdog ----
const WATCH_MS = 100;
let lastCtxTime = -1;
let stuckMs = 0;
let silentMs = 0;
let restarts: number[] = [];
/** The prompt is up because the context stopped (clears itself when it runs again). */
let ctxStall = false;

/** Loop position heard now (where to continue after a restart). */
const herePos = (): number => progress.get().pos;

/** Starts the same rhythm again at the same spot (engine or context trouble). */
function restartHere(): void {
  const now = Date.now();
  restarts = restarts.filter((t) => now - t < 30000);
  restarts.push(now);
  silentMs = 0;
  // Still silent after several tries: stop trying and ask for a tap instead.
  if (restarts.length > 3) {
    player.set((s) => ({ ...s, stalled: true }));
    return;
  }
  // The tempo engine failed twice in a short time: use <audio> from now on.
  if (restarts.length >= 2 && active?.kind === 'stretch') stretchBroken = true;
  playRhythm(herePos());
}

function watch(ctx: AudioContext): void {
  const { playing, loading, fading, volume, stalled } = player.get();
  if (!playing || loading) return;
  const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
  // Clock frozen or context not running: the phone took the sound away.
  if (ctx.state !== 'running' || ctx.currentTime === lastCtxTime) {
    stuckMs += WATCH_MS;
    if (stuckMs === 600) void ctx.resume().catch(() => undefined);
    if (stuckMs >= 2500 && visible && !stalled) {
      ctxStall = true;
      player.set((s) => ({ ...s, stalled: true }));
    }
    lastCtxTime = ctx.currentTime;
    return;
  }
  lastCtxTime = ctx.currentTime;
  stuckMs = 0;
  if (stalled && ctxStall) {
    ctxStall = false;
    player.set((s) => ({ ...s, stalled: false }));
  }
  if (stalled) return;
  // Clock runs but nothing comes out of the rhythm: restart it where it was.
  if (!meter || !meterBuf || fading || volume < 0.05 || !visible) {
    silentMs = 0;
    return;
  }
  meter.getFloatTimeDomainData(meterBuf);
  let peak = 0;
  for (let i = 0; i < meterBuf.length; i += 4) peak = Math.max(peak, Math.abs(meterBuf[i]));
  silentMs = peak < 1e-4 ? silentMs + WATCH_MS : 0;
  if (silentMs >= 3500) restartHere();
}

/**
 * "Ses durdu" prompt tapped: a fresh audio context (inside the tap, so iOS
 * allows it) and the rhythm continues where it was.
 */
export function recoverAudio(): void {
  const pos = herePos();
  player.set((s) => ({ ...s, stalled: false }));
  stuckMs = 0;
  ctxStall = false;
  restarts = [];
  recreateAudio();
  if (currentRhythm()) playRhythm(pos);
}

function tick(): void {
  if (!active) return;
  const ctx = audioContext();
  watch(ctx);
  if (!active) return;
  // An engine that stopped by itself has no position: keep the last one (the watchdog restarts there).
  const pos = active.posAt(ctx.currentTime) ?? progress.get().pos;
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

/** Starts the selected rhythm (from loop position `offset`, s). Call from a tap. */
export function playRhythm(offset = 0): void {
  const r = currentRhythm();
  if (!r) {
    player.set((s) => ({ ...s, error: 'Önce bir ritim seçin.' }));
    return;
  }
  // Synchronous part, inside the tap: unlock the context and the <audio> element (iOS).
  unlockAudio();
  holdAudio('rhythm', true);
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
      try {
        await engine.start(appliedRate, offset);
      } catch (e) {
        throw new EngineError(e instanceof Error ? e.message : String(e));
      }
      if (my !== token) return;
      setGain(player.get().volume, 0.03);
      lastPos = offset;
      lastCtxTime = -1;
      stuckMs = 0;
      silentMs = 0;
      progress.set({ pos: offset, dur: engine.loopLen() || r.duration, loops: offset ? progress.get().loops : 0 });
      const { timerMin } = player.get();
      const keepTimer = offset > 0 && player.get().endsAt;
      player.set((s) => ({
        ...s,
        playing: true,
        loading: false,
        fading: false,
        stalled: false,
        endsAt: keepTimer ? s.endsAt : timerMin ? Date.now() + timerMin * 60000 : undefined,
      }));
      clearInterval(ticker);
      ticker = setInterval(tick, 100);
      void requestWakeLock();
      updateMediaSession();
    } catch (e) {
      if (my !== token) return;
      console.warn(e);
      // The tempo engine could not load or start this rhythm: try once more with <audio>.
      if (e instanceof EngineError && useStretch()) {
        stretchBroken = true;
        playRhythm(offset);
        return;
      }
      const msg = e instanceof Error && e.name === 'NotAllowedError' ? 'Başlatmak için START tuşuna tekrar dokunun.' : 'Ritim çalınamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.';
      player.set((s) => ({ ...s, playing: false, loading: false, error: msg }));
    }
  })();
}

/** Stops with a short fade (no click). */
export function stopRhythm(fade = 0.12): void {
  const my = ++token;
  holdAudio('rhythm', false);
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
  player.set((s) => ({ ...s, playing: false, loading: false, fading: false, stalled: false, endsAt: undefined }));
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

/** For tests: the engine playing now. */
export const activeEngine = (): RhythmEngine | undefined => active;

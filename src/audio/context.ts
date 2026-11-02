// One shared AudioContext for the rhythm player, the metronome and the tuner.
// It must be created/resumed inside a tap on iOS, so unlockAudio() is called
// from every START handler before any await.
//
// iPhone: Web Audio is muted by the ring/silent switch unless the page's audio
// session is "playback". navigator.audioSession (Safari 17+) sets that; older
// iOS gets it from a silent <audio> element kept playing while sound is on.
// Interruptions (calls, Siri, other apps, route changes) suspend the context;
// it is resumed on the next tap or when the page comes back, and can be
// rebuilt from scratch (recreateAudio) when it stays stuck.

import { createStore } from '../lib/store';

let ctx: AudioContext | undefined;
let master: GainNode | undefined;

export type AudioState = AudioContextState | 'interrupted' | 'none';
/** Current state of the context (for the "Ses durdu" prompt). */
export const audioState = createStore<AudioState>('none');

const resetListeners = new Set<() => void>();

/** Called after recreateAudio(): drop every node of the old context. */
export function onAudioReset(fn: () => void): void {
  resetListeners.add(fn);
}

export const isIOS = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));

function playbackSession(): void {
  try {
    const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (s && s.type !== 'playback') s.type = 'playback';
  } catch {
    /* not supported */
  }
}

export function audioContext(): AudioContext {
  if (!ctx) {
    playbackSession();
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // A larger output buffer: weaker phones keep up with the tempo engine without dropouts.
    const c = new C({ latencyHint: 'playback' });
    ctx = c;
    master = c.createGain();
    master.connect(c.destination);
    audioState.set(c.state as AudioState);
    c.onstatechange = () => {
      if (c !== ctx) return;
      audioState.set(c.state as AudioState);
      // Interrupted while sound is wanted: try to come back as soon as the page is visible.
      if (c.state !== 'running' && c.state !== 'closed' && holders.size && document.visibilityState === 'visible') {
        setTimeout(() => {
          if (c === ctx && c.state !== 'running' && c.state !== 'closed') void c.resume().catch(() => undefined);
        }, 300);
      }
    };
  }
  return ctx;
}

export function masterOut(): GainNode {
  audioContext();
  return master!;
}

/** Call synchronously from a user gesture. */
export function unlockAudio(): AudioContext {
  playbackSession();
  const c = audioContext();
  if (c.state !== 'running') void c.resume().catch(() => undefined);
  return c;
}

/** Throws the context away and starts a new one (call from a tap). */
export function recreateAudio(): AudioContext {
  const old = ctx;
  ctx = undefined;
  master = undefined;
  if (old) void old.close().catch(() => undefined);
  resetListeners.forEach((fn) => fn());
  return unlockAudio();
}

// ---- iOS audio session keep-alive ----

/** Who needs sound now (rhythm, metronome…); the keep-alive runs while any does. */
const holders = new Set<string>();
let keep: HTMLAudioElement | undefined;

function silentWavUrl(): string {
  const sr = 8000;
  const n = sr; // 1 s of silence
  const b = new ArrayBuffer(44 + n * 2);
  const v = new DataView(b);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

/**
 * Marks that `who` needs sound (or not any more). On iPhone a silent looping
 * <audio> (not routed through Web Audio) plays meanwhile, which puts the page
 * in the playback audio session so the silent switch does not mute it.
 * Call with on = true from a tap.
 */
export function holdAudio(who: string, on: boolean): void {
  if (on) holders.add(who);
  else holders.delete(who);
  if (!isIOS()) return;
  if (holders.size) {
    if (!keep) {
      keep = new Audio(silentWavUrl());
      keep.loop = true;
      keep.setAttribute('playsinline', '');
    }
    if (keep.paused) void keep.play().catch(() => undefined);
  } else keep?.pause();
}

if (typeof document !== 'undefined') {
  // Back to the page, or any tap: wake the context (and the keep-alive) if sound is wanted.
  const wake = () => {
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);
    if (holders.size && keep?.paused) void keep.play().catch(() => undefined);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
  document.addEventListener('pointerdown', wake, { capture: true });
}

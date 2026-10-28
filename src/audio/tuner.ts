// Tuner engine: microphone → analyser → pitch detection ~20 times a second,
// steadied with a short median. Also plays reference tones for the strings.

import { createStore, persist } from '../lib/store';
import { audioContext, masterOut, unlockAudio } from './context';
import { TUNINGS, detectPitchFine, freqOf, matchString, median, readNote, type Naming, type Tuning } from './pitch';

export interface TunerSettings {
  /** Reference A4 in Hz. */
  a4: number;
  naming: Naming;
  tuningId: string;
  /** Strings of "Kendi düzenim" (MIDI, low to high). */
  custom: number[];
}

export interface TunerReading {
  freq: number;
  midi: number;
  cents: number;
  /** Index of the matched string of the tuning, or -1. */
  string: number;
  /** Time of the reading (performance.now) — older readings fade out. */
  at: number;
}

export interface TunerState {
  listening: boolean;
  starting: boolean;
  error?: string;
  reading?: TunerReading;
}

export const DEFAULT_TUNER: TunerSettings = { a4: 440, naming: 'solfej', tuningId: 'kromatik', custom: [62, 67, 69] };

export const tunerSettings = createStore<TunerSettings>(DEFAULT_TUNER);
persist(tunerSettings, 'ritim.tuner.v1', (raw): TunerSettings => {
  const r = (raw ?? {}) as Partial<TunerSettings>;
  const custom = Array.isArray(r.custom) && r.custom.length >= 1 && r.custom.length <= 8 && r.custom.every((m) => Number.isInteger(m) && m >= 24 && m <= 96) ? r.custom : DEFAULT_TUNER.custom;
  return {
    a4: typeof r.a4 === 'number' && r.a4 >= 415 && r.a4 <= 466 ? Math.round(r.a4) : 440,
    naming: r.naming === 'harf' ? 'harf' : 'solfej',
    tuningId: TUNINGS.some((t) => t.id === r.tuningId) ? (r.tuningId as string) : 'kromatik',
    custom,
  };
});

export const tuner = createStore<TunerState>({ listening: false, starting: false });

export function currentTuning(s: TunerSettings = tunerSettings.get()): Tuning {
  const t = TUNINGS.find((x) => x.id === s.tuningId) ?? TUNINGS[0];
  return t.id === 'ozel' ? { ...t, strings: s.custom } : t;
}

let stream: MediaStream | undefined;
let source: AudioNode | undefined;
let analyser: AnalyserNode | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let history: number[] = [];
let frame: Float32Array | undefined;

function analyse(): void {
  if (!analyser || !frame) return;
  analyser.getFloatTimeDomainData(frame);
  const p = detectPitchFine(frame, analyser.context.sampleRate);
  if (!p || p.freq < 55 || p.freq > 1500) {
    // Silence: keep the last reading on screen for a moment (it fades in the UI).
    if (history.length) history = [];
    return;
  }
  // A new note (more than a semitone away): start the median over.
  if (history.length && Math.abs(12 * Math.log2(p.freq / median(history))) > 0.7) history = [];
  history.push(p.freq);
  if (history.length > 5) history.shift();
  const freq = median(history);
  const s = tunerSettings.get();
  const { midi, cents } = readNote(freq, s.a4);
  const m = 69 + 12 * Math.log2(freq / s.a4);
  tuner.set((st) => ({ ...st, reading: { freq, midi, cents, string: matchString(currentTuning(s), m), at: performance.now() } }));
}

function listen(node: AudioNode): void {
  const ctx = audioContext();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  frame = new Float32Array(analyser.fftSize);
  // Cut rumble below the lowest string; the analyser is not connected to the speakers.
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 45;
  node.connect(hp).connect(analyser);
  source = node;
  history = [];
  clearInterval(timer);
  timer = setInterval(analyse, 50);
  tuner.set((s) => ({ ...s, listening: true, starting: false, error: undefined }));
}

/** Asks for the microphone and starts listening. Call from a tap. */
export async function startTuner(): Promise<void> {
  if (tuner.get().listening || tuner.get().starting) return;
  unlockAudio();
  tuner.set((s) => ({ ...s, starting: true, error: undefined }));
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    listen(audioContext().createMediaStreamSource(stream));
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    const error =
      name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Mikrofon izni verilmedi. Tarayıcı ayarlarından bu siteye mikrofon izni verin.'
        : name === 'NotFoundError'
          ? 'Mikrofon bulunamadı.'
          : 'Mikrofon açılamadı. Tarayıcınız desteklemiyor olabilir.';
    tuner.set((s) => ({ ...s, starting: false, listening: false, error }));
  }
}

export function stopTuner(): void {
  clearInterval(timer);
  timer = undefined;
  source?.disconnect();
  source = undefined;
  analyser = undefined;
  stream?.getTracks().forEach((t) => t.stop());
  stream = undefined;
  history = [];
  tuner.set({ listening: false, starting: false });
}

/** For testing without a microphone: listen to any audio node. */
export function listenTo(node: AudioNode): void {
  stopTuner();
  listen(node);
}

/** Plucked reference tone for a string (a few harmonics, 2.5 s decay). */
export function playReference(midi: number): void {
  const ctx = unlockAudio();
  const f = freqOf(midi, tunerSettings.get().a4);
  const t = ctx.currentTime + 0.02;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
  out.connect(masterOut());
  [1, 0.5, 0.3, 0.15].forEach((a, h) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f * (h + 1);
    g.gain.value = a / (h + 1.5);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 2.6);
    o.onended = () => g.disconnect();
  });
  setTimeout(() => out.disconnect(), 2800);
}

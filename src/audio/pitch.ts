// Pure pitch tools for the tuner: YIN pitch detection, note names
// (Do Re Mi or C D E), cents / koma off the nearest note, instrument tunings.

/** Detected fundamental (Hz) and how clear the period was (0 = noise, 1 = pure). */
export interface PitchResult {
  freq: number;
  clarity: number;
}

/**
 * YIN pitch detection (de Cheveigné & Kawahara) on one frame.
 * Returns undefined for silence or no clear pitch.
 */
export function detectPitch(frame: Float32Array, sampleRate: number, minHz = 55, maxHz = 1500, threshold = 0.15): PitchResult | undefined {
  const n = frame.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += frame[i] * frame[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.006) return undefined;
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / minHz));
  const w = n - tauMax;
  if (w < 32) return undefined;
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const x = frame[i] - frame[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  // Cumulative mean normalised difference.
  let sum = 0;
  d[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    sum += d[tau];
    d[tau] = sum > 0 ? (d[tau] * tau) / sum : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return undefined;
  // Parabolic interpolation around the minimum for sub-sample precision.
  const a = d[tau - 1] ?? d[tau];
  const b = d[tau];
  const c = d[tau + 1] ?? d[tau];
  const denom = a + c - 2 * b;
  const shift = denom !== 0 ? (a - c) / (2 * denom) : 0;
  const period = tau + Math.max(-1, Math.min(1, shift));
  return { freq: sampleRate / period, clarity: 1 - b };
}

/** Halves the sample rate (pairs averaged): 4× less work for the same frequency range. */
export function decimate2(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = (x[2 * i] + x[2 * i + 1]) * 0.5;
  return out;
}

/**
 * Two-stage detection: YIN on the half-rate frame (cheap), then the period
 * refined on the full-rate frame around it (precise to a fraction of a cent).
 */
export function detectPitchFine(frame: Float32Array, sampleRate: number): PitchResult | undefined {
  const coarse = detectPitch(decimate2(frame), sampleRate / 2);
  if (!coarse) return undefined;
  const T = sampleRate / coarse.freq;
  const lo = Math.max(2, Math.floor(T) - 3);
  const hi = Math.ceil(T) + 3;
  const w = frame.length - hi - 1;
  if (w < 64) return coarse;
  const diff = (tau: number): number => {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const x = frame[i] - frame[i + tau];
      s += x * x;
    }
    return s;
  };
  let best = lo;
  let bestD = Infinity;
  const ds: number[] = [];
  for (let tau = lo; tau <= hi; tau++) {
    const d = diff(tau);
    ds[tau] = d;
    if (d < bestD) {
      bestD = d;
      best = tau;
    }
  }
  const a = ds[best - 1] ?? diff(best - 1);
  const c = ds[best + 1] ?? diff(best + 1);
  const denom = a + c - 2 * bestD;
  const shift = denom > 0 ? (a - c) / (2 * denom) : 0;
  return { freq: sampleRate / (best + Math.max(-1, Math.min(1, shift))), clarity: coarse.clarity };
}

export type Naming = 'solfej' | 'harf';

const SOLFEJ = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const HARF = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const noteName = (midi: number, naming: Naming): string => (naming === 'solfej' ? SOLFEJ : HARF)[((midi % 12) + 12) % 12];

export const octaveOf = (midi: number): number => Math.floor(midi / 12) - 1;

export interface NoteReading {
  midi: number;
  /** -50 … +50 */
  cents: number;
}

export const midiOf = (freq: number, a4 = 440): number => 69 + 12 * Math.log2(freq / a4);
export const freqOf = (midi: number, a4 = 440): number => a4 * 2 ** ((midi - 69) / 12);

export function readNote(freq: number, a4 = 440): NoteReading {
  const m = midiOf(freq, a4);
  const midi = Math.round(m);
  return { midi, cents: (m - midi) * 100 };
}

/** Holderian koma: 1/53 octave ≈ 22.64 cents (Turkish music). */
export const KOMA_CENTS = 1200 / 53;

export interface TuningString {
  /** MIDI note (concert pitch). */
  midi: number;
}

export interface Tuning {
  id: string;
  name: string;
  /** Strings from low to high; empty = chromatic. */
  strings: number[];
  /** Match strings by note name only (octave varies between instruments). */
  anyOctave?: boolean;
}

// MIDI numbers: E2 40, A2 45, D3 50, G3 55, B3 59, E4 64; La4 = 69.
export const TUNINGS: Tuning[] = [
  { id: 'kromatik', name: 'Kromatik (her nota)', strings: [] },
  { id: 'gitar', name: 'Gitar · standart (Mi La Re Sol Si Mi)', strings: [40, 45, 50, 55, 59, 64] },
  { id: 'gitar-dropd', name: 'Gitar · Drop D', strings: [38, 45, 50, 55, 59, 64] },
  { id: 'gitar-yarim', name: 'Gitar · yarım ses pes', strings: [39, 44, 49, 54, 58, 63] },
  { id: 'baglama-bozuk', name: 'Bağlama · bozuk düzen (Re Sol La)', strings: [62, 67, 69], anyOctave: true },
  { id: 'ozel', name: 'Kendi düzenim', strings: [62, 67, 69], anyOctave: true },
];

/** Index of the tuning string the note belongs to (nearest), or -1. */
export function matchString(t: Tuning, midiFloat: number): number {
  if (!t.strings.length) return -1;
  let best = -1;
  let dist = Infinity;
  t.strings.forEach((s, i) => {
    const d = t.anyOctave ? Math.abs((((midiFloat - s) % 12) + 18) % 12 - 6) : Math.abs(midiFloat - s);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return dist <= 1.5 ? best : -1;
}

/** Median of the last readings: steadies the needle without lagging much. */
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

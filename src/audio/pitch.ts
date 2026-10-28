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

/**
 * Names for the two ends of the needle (half way to the neighbour notes):
 * the note's flat and sharp (Sol♭ / Sol♯); where there is no such note the
 * neighbour natural (Mi → Fa, Do → Si); for a sharp note its naturals (Fa♯ → Fa / Sol).
 */
export function flatSharpNames(midi: number, naming: Naming): [string, string] {
  const pc = ((midi % 12) + 12) % 12;
  const base = noteName(midi, naming);
  if (base.includes('#')) return [noteName(midi - 1, naming), noteName(midi + 1, naming)];
  const lower = pc === 0 || pc === 5 ? noteName(midi - 1, naming) : `${base}♭`;
  const upper = pc === 4 || pc === 11 ? noteName(midi + 1, naming) : `${base}♯`;
  return [lower, upper];
}

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

export type Instrument = 'kromatik' | 'kisasap' | 'baglama' | 'gitar' | 'ozel';

export interface Tuning {
  id: string;
  instrument: Instrument;
  name: string;
  /** Strings (MIDI, concert pitch); empty = chromatic. Bağlama: alt, orta, üst. */
  strings: number[];
  /** Match strings by note name only (octave varies between instruments). */
  anyOctave?: boolean;
  /** Names of the string groups (bağlama: Alt / Orta / Üst). */
  labels?: string[];
  /** Where the tuning is usual. */
  note?: string;
}

// MIDI numbers: E2 40, A2 45, D3 50, G3 55, B3 59, E4 64; La4 = 69.
// Bağlama düzenleri in Turkish notation, alt tel = La (sources: Kültür ve
// Turizm Bakanlığı, Türkü Sitesi, muzikogretmeni.net, tr.wikipedia "Bağlama").
// Notes are matched in any octave, so kısa sap and uzun sap both work; the
// "ses seviyesi" setting moves all strings together (e.g. bağlama düzeni in
// La karar = Re–Sol–La).
const LA = 57;
const RE = 62;
const MI = 64;
const FA = 65;
const FAD = 66;
const SOL = 67;
const SOL_LA = 69;
const SI = 71;
const DO = 60;
const BAGLAMA = ['Alt', 'Orta', 'Üst'];

/** Kısa sap düzenleri: id, üst tel (MIDI), names of alt / orta / üst. */
const KISA_SAP: [string, number, [string, string, string]][] = [
  ['do', DO + 12, ['Fa', 'Si♭', 'Do']],
  ['re', RE, ['Sol', 'Do', 'Re']],
  ['mi', MI, ['La', 'Re', 'Mi']],
  ['fa', FA, ['Si♭', 'Mi♭', 'Fa']],
  ['sol', SOL, ['Do', 'Fa', 'Sol']],
  ['la', SOL_LA, ['Re', 'Sol', 'La']],
  ['si', SI, ['Mi', 'La', 'Si']],
];

export const TUNINGS: Tuning[] = [
  { id: 'kromatik', instrument: 'kromatik', name: 'Kromatik (her nota)', strings: [] },
  { id: 'gitar', instrument: 'gitar', name: 'Standart (Mi La Re Sol Si Mi)', strings: [40, 45, 50, 55, 59, 64] },
  { id: 'gitar-dropd', instrument: 'gitar', name: 'Drop D', strings: [38, 45, 50, 55, 59, 64] },
  { id: 'gitar-yarim', instrument: 'gitar', name: 'Yarım ses pes', strings: [39, 44, 49, 54, 58, 63] },
  // Kısa sap: bağlama düzeni at every pitch level. "X düzeni": üst X,
  // orta a tone lower, alt a fifth lower (Si: Mi–La–Si, La: Re–Sol–La).
  ...KISA_SAP.map(([key, top, names]) => ({
    id: `kisa-${key}`,
    instrument: 'kisasap' as const,
    name: `${names[2]} düzeni (${names.join(' ')})`,
    strings: [top - 7, top - 2, top],
    anyOctave: true,
    labels: BAGLAMA,
    note: `Kısa sap · alt ${names[0]}, orta ${names[1]}, üst ${names[2]}.`,
  })),
  { id: 'baglama-bozuk', instrument: 'baglama', name: 'Bozuk (Kara) düzen', strings: [LA, RE, SOL], anyOctave: true, labels: BAGLAMA, note: 'Uzun sapta en yaygın düzen.' },
  { id: 'baglama-baglama', instrument: 'baglama', name: 'Bağlama düzeni', strings: [LA, RE, MI], anyOctave: true, labels: BAGLAMA, note: 'Yazımda La–Re–Mi. Kısa sap için “Kısa sap” sekmesindeki Do–Si düzenlerine bakın.' },
  { id: 'baglama-misket', instrument: 'baglama', name: 'Misket düzeni', strings: [LA, RE, FAD], anyOctave: true, labels: BAGLAMA },
  { id: 'baglama-fa-mustezat', instrument: 'baglama', name: 'Fa müstezat (Acem) düzeni', strings: [LA, RE, FA], anyOctave: true, labels: BAGLAMA },
  { id: 'baglama-abdal', instrument: 'baglama', name: 'Abdal (Bozlak) düzeni', strings: [LA, LA, SOL], anyOctave: true, labels: BAGLAMA, note: 'Açıktan çalma; alt ve orta teller aynı ses.' },
  { id: 'baglama-do-mustezat', instrument: 'baglama', name: 'Do müstezat (Rast) düzeni', strings: [LA, DO, SOL], anyOctave: true, labels: BAGLAMA },
  { id: 'baglama-kutahya', instrument: 'baglama', name: 'Kütahya düzeni', strings: [LA, RE, RE], anyOctave: true, labels: BAGLAMA },
  { id: 'ozel', instrument: 'ozel', name: 'Kendi düzenim', strings: [LA, RE, SOL], anyOctave: true },
];

export const INSTRUMENTS: { id: Instrument; label: string }[] = [
  { id: 'kromatik', label: 'Kromatik' },
  { id: 'kisasap', label: 'Kısa sap' },
  { id: 'baglama', label: 'Uzun sap' },
  { id: 'gitar', label: 'Gitar' },
  { id: 'ozel', label: 'Kendi' },
];

/** The tuning with all strings moved by `shift` semitones (bağlama ses seviyesi). */
export const shifted = (t: Tuning, shift: number): Tuning => (shift ? { ...t, strings: t.strings.map((m) => m + shift) } : t);

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

// "Dinle": the meter from a recording (microphone or a file) instead of taps.
//
//  1. Onset strength: spectral flux of the log spectrum, ~11 ms frames, plus
//     a low band (< 250 Hz: davul/darbuka "düm") for accents.
//  2. Eighth note (tatum): the strongest autocorrelation lag between 90 and
//     300 ms, refined by its multiples.
//  3. Cycle: how many eighths repeat (4 … 10), from autocorrelation at
//     k × eighth; multiples of a shorter cycle are not preferred.
//  4. Grouping: the onset strength folded over one cycle gives an accent
//     profile per eighth; it is compared with the beat starts of every usul
//     of that length, in every rotation (the cycle starts on its strongest
//     low-band eighth).
// The result has the same shape as the tap analysis, labelled as a guess.

import { AKSAK_USULS, EVEN_METERS } from './usuls';
import type { Candidate, MeterResult } from './meter';

export interface ListenResult extends MeterResult {
  /** Onset times found (ms), for drawing. */
  onsets: number[];
}

const HOP = 512;
const WIN = 1024;

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const wr = Math.cos(a);
    const wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Onset strength per frame (all bands and the low band), mean-removed and half-wave rectified. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): { flux: Float64Array; low: Float64Array; frameSec: number } {
  const frames = Math.max(0, Math.floor((samples.length - WIN) / HOP));
  const flux = new Float64Array(frames);
  const low = new Float64Array(frames);
  const lowBin = Math.max(2, Math.round((250 * WIN) / sampleRate));
  const win = new Float64Array(WIN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)));
  let prev = new Float64Array(WIN / 2);
  const re = new Float64Array(WIN);
  const im = new Float64Array(WIN);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < WIN; i++) {
      re[i] = samples[off + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float64Array(WIN / 2);
    let s = 0;
    let sl = 0;
    for (let k = 1; k < WIN / 2; k++) {
      mag[k] = Math.log1p(1000 * Math.hypot(re[k], im[k]));
      const d = mag[k] - prev[k];
      if (d > 0) {
        s += d;
        if (k <= lowBin) sl += d;
      }
    }
    flux[f] = s;
    low[f] = sl;
    prev = mag;
  }
  // Remove the slow trend so loud passages do not dominate.
  const detrend = (x: Float64Array) => {
    const out = new Float64Array(x.length);
    const h = 20;
    for (let i = 0; i < x.length; i++) {
      let m = 0;
      let n = 0;
      for (let j = Math.max(0, i - h); j < Math.min(x.length, i + h + 1); j++) {
        m += x[j];
        n++;
      }
      out[i] = Math.max(0, x[i] - m / n);
    }
    return out;
  };
  return { flux: detrend(flux), low: detrend(low), frameSec: HOP / sampleRate };
}

function autocorr(x: Float64Array, lag: number): number {
  let s = 0;
  for (let i = lag; i < x.length; i++) s += x[i] * x[i - lag];
  return s / (x.length - lag || 1);
}

/** Autocorrelation at a fractional lag (linear interpolation between frames). */
function acAt(x: Float64Array, lag: number): number {
  const a = Math.floor(lag);
  const f = lag - a;
  return autocorr(x, a) * (1 - f) + autocorr(x, a + 1) * f;
}

/** Gaussian blur, σ ≈ 1.2 frames. */
function blur(x: Float64Array): Float64Array {
  const k = [0.05, 0.24, 0.42, 0.24, 0.05];
  return x.map((_, i) => k.reduce((s, w, j) => s + w * (x[Math.min(x.length - 1, Math.max(0, i + j - 2))] ?? 0), 0));
}

/** Peak-picked onset times (ms). */
function peaks(env: Float64Array, frameSec: number): number[] {
  const out: number[] = [];
  const minGap = Math.round(0.07 / frameSec);
  let last = -minGap;
  for (let i = 2; i < env.length - 2; i++) {
    let m = 0;
    let n = 0;
    for (let j = Math.max(0, i - 15); j < Math.min(env.length, i + 16); j++) {
      m += env[j];
      n++;
    }
    const thr = (m / n) * 1.5 + 1e-6;
    if (env[i] > thr && env[i] >= env[i - 1] && env[i] >= env[i + 1] && i - last >= minGap) {
      out.push(i * frameSec * 1000);
      last = i;
    }
  }
  return out;
}

const BEAT_STARTS = (groups: number[]) => {
  const s: number[] = [];
  let p = 0;
  for (const g of groups) {
    s.push(p);
    p += g;
  }
  return s;
};

/** The eighth-note grid method (needs onsets on most eighths: saz, darbuka fill-ins). */
function analyseGrid(env: ReturnType<typeof onsetEnvelope>): ListenResult | undefined {
  const { frameSec } = env;
  // Onsets are one-frame spikes; a slight blur lets periods that fall between frames correlate fully.
  const flux = blur(env.flux);
  const low = blur(env.low);
  const lagOf = (ms: number) => ms / 1000 / frameSec;

  // 2. Cycle first: how often the low "düm" repeats (0.4–3.2 s). A shorter period that is nearly as
  // strong wins (a motif repeated twice is still one cycle).
  const acc = new Float64Array(flux.length).map((_, i) => flux[i] + 2 * low[i]);
  const cycLo = Math.floor(lagOf(400));
  const cycHi = Math.min(Math.ceil(lagOf(3200)), Math.floor(flux.length / 3));
  if (cycHi <= cycLo) return undefined;
  const lowBase = autocorr(low, 0) || 1;
  const cycAc = (L: number) => (0.75 * acAt(low, L)) / lowBase + (0.25 * acAt(acc, L)) / (autocorr(acc, 0) || 1);
  let C = 0;
  let cv = -1;
  for (let L = cycLo; L <= cycHi; L++) {
    const v = cycAc(L);
    if (v > cv) {
      cv = v;
      C = L;
    }
  }
  for (const d of [2, 3]) if (C / d >= cycLo && cycAc(C / d) >= 0.85 * cv) C = C / d;
  // Sub-frame refinement of the cycle length.
  let bestC = C;
  for (let d = -1; d <= 1; d += 0.1) if (cycAc(C + d) > cycAc(bestC)) bestC = C + d;
  C = bestC;

  // 3. Eighths per cycle: the division of the cycle whose grid the onsets fill best. A grid twice as
  // fine finds nothing between the eighths, so it scores lower.
  const fluxBase = autocorr(flux, 0) || 1;
  const order: [number, number][] = [];
  for (let k = 4; k <= 10; k++) {
    const T = C / k;
    const ms = T * frameSec * 1000;
    if (ms < 70 || ms > 340) continue;
    let s = 0;
    for (let j = 1; j < k; j++) s += acAt(flux, j * T) / fluxBase;
    // Off-grid check: halfway between eighths should be quiet.
    let off = 0;
    for (let j = 0; j < k; j++) off += acAt(flux, (j + 0.5) * T) / fluxBase;
    order.push([k, s / (k - 1) - 0.5 * (off / k)]);
  }
  if (!order.length) return undefined;
  order.sort((a, b) => b[1] - a[1]);
  const cycle = order[0][0];
  const tatum0 = C / cycle;

  // 4. Accent profile over one cycle, on an eighth grid fitted to the onsets: the period (±1.5 %)
  // and phase that put the most onset energy on grid points. A tiny period error would otherwise
  // pile up over 20 s and slide accents into the neighbouring eighth.
  let tatum = tatum0;
  let phase = 0;
  let pv = -1;
  for (let f = 0.985; f <= 1.015; f += 0.001) {
    const T = tatum0 * f;
    for (let ph = 0; ph < T; ph += 0.25) {
      let s = 0;
      for (let x = ph; x < flux.length - 1; x += T) s += flux[Math.round(x)];
      if (s > pv) {
        pv = s;
        phase = ph;
        tatum = T;
      }
    }
  }
  const prof = new Float64Array(cycle);
  const lowProf = new Float64Array(cycle);
  const counts = new Float64Array(cycle);
  for (let i = 0; i < acc.length; i++) {
    const g = (i - phase) / tatum;
    const n = Math.round(g);
    const pos = ((n % cycle) + cycle) % cycle;
    const near = Math.abs(g - n) < 0.3;
    if (!near) continue;
    prof[pos] += flux[i];
    lowProf[pos] += low[i];
    counts[pos]++;
  }
  for (let p = 0; p < cycle; p++) {
    prof[p] /= counts[p] || 1;
    lowProf[p] /= counts[p] || 1;
  }
  // The cycle starts on its strongest low ("düm") eighth.
  const start = lowProf.indexOf(Math.max(...lowProf));
  const rot = (x: Float64Array) => Float64Array.from({ length: cycle }, (_, p) => x[(p + start) % cycle]);
  const P = rot(prof);
  const mean = P.reduce((a, b) => a + b, 0) / cycle;

  const eighthMs = tatum * frameSec * 1000;
  const onsets = peaks(env.flux, frameSec);
  const scoreGroups = (groups: number[]) => {
    const starts = new Set(BEAT_STARTS(groups));
    let on = 0;
    let off = 0;
    for (let p = 0; p < cycle; p++) (starts.has(p) ? (on += P[p]) : (off += P[p]));
    const nOn = starts.size;
    const nOff = cycle - nOn;
    return nOff ? on / nOn / (off / nOff + mean * 0.1) : 1;
  };

  let candidates: Candidate[];
  let kind: ListenResult['kind'];
  if ([5, 7, 9, 10].includes(cycle)) {
    kind = 'aksak';
    candidates = AKSAK_USULS.filter((d) => d.groups.reduce((a, b) => a + b, 0) === cycle)
      .map((d) => ({ meter: d.meter, name: d.name, groups: d.groups, score: scoreGroups(d.groups), fit: 1 }))
      .sort((a, b) => b.score - a.score);
    const top = candidates[0].score;
    candidates = candidates.map((c) => ({ ...c, score: Math.min(0.95, 0.5 * (c.score / top)) + (c === candidates[0] ? 0.4 : 0), fit: c.score / top }));
  } else {
    kind = 'even';
    const beats = cycle === 6 ? 0 : cycle === 8 ? 4 : 2;
    candidates =
      cycle === 6
        ? [{ meter: '6/8', name: '6/8 (3+3)', groups: [3, 3], score: 0.8, fit: 1 }]
        : EVEN_METERS.filter((m) => m.beats !== 3)
            .map((m) => ({ meter: m.meter, name: m.name, groups: Array(m.beats).fill(2), score: m.beats === beats ? 0.8 : 0.5, fit: 1 }))
            .sort((a, b) => b.score - a.score);
  }
  // Sure when the düm repeats clearly and one division of the cycle stands out.
  const sure = cv > 0.12 && (order[1] ? order[0][1] - order[1][1] > 0.01 : true);
  const best = candidates[0];
  return {
    kind: sure ? kind : 'unclear',
    candidates,
    unitMs: eighthMs,
    bpm: 60000 / eighthMs,
    labels: [],
    shortMs: 2 * eighthMs,
    longMs: 3 * eighthMs,
    cycles: (flux.length * frameSec * 1000) / (cycle * eighthMs),
    message: sure
      ? `Kayıtta sekizlik ≈ ${Math.round(eighthMs)} ms, döngü ${cycle} sekizlik → ${best.meter}${kind === 'aksak' ? ` (${best.groups.join('+')})` : ''}. Bu bir tahmindir: "Bu tempoda dinle" ile türküyle karşılaştırın. Kayıttan bulmada 2/4 ile 4/4, 5/8 ile 10/8 birbirine karışabilir (biri ötekinin iki katıdır).`
      : 'Kayıttaki vuruş düzeni net değil (ses az, yankılı ya da serbest ritimli olabilir). Daha yakından, ritmin belirgin olduğu bir bölümü 15–20 saniye kaydedin ya da birlikte vurarak bulun.',
    onsets,
  };
}


/** Meter from audio samples (mono). Undefined when the recording is too short. Works best when most
 * eighths are played (saz, darbuka); with only sparse düm–tek strokes it reports "unclear". */
export function analyseAudio(samples: Float32Array, sampleRate: number): ListenResult | undefined {
  if (samples.length < sampleRate * 6) return undefined;
  return analyseGrid(onsetEnvelope(samples, sampleRate));
}

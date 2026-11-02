// Finds a song's meter from taps made along with it ("birlikte vur").
//
// The listener taps every beat they feel. In an aksak meter the beats are of
// two lengths — short (2 eighths) and long (3 eighths), ratio ≈ 1.5 — and the
// pattern of shorts and longs repeats every cycle (9/8 = 2+2+2+3). So:
//  1. split the gaps between taps into a short and a long group (1-D 2-means);
//  2. if the groups are ~1.5× apart it is aksak: label every gap 2 or 3 and
//     find the usul whose repeating pattern fits the labels best;
//     otherwise the beats are even (2/4, 3/4, 4/4).
// Optional accent taps ("DÜM") mark the first beat of a cycle; they settle
// where the cycle starts (2+2+2+3 vs 3+2+2+2) and the size of even cycles.

import { AKSAK_USULS, EVEN_METERS, rotate, type UsulDef } from './usuls';

export interface Tap {
  /** Milliseconds (performance.now()). */
  t: number;
  /** Tapped on the strong "DÜM" button. */
  accent?: boolean;
}

export interface Candidate {
  meter: string;
  name: string;
  /** Eighths per beat from the cycle start. */
  groups: number[];
  /** 0–1: how well the taps fit, including how common the usul is. */
  score: number;
  /** Fraction of gaps that match the pattern. */
  fit: number;
}

export interface MeterResult {
  kind: 'aksak' | 'even' | 'unclear';
  candidates: Candidate[];
  /** Length of one eighth note (aksak) or of one beat (even), ms. */
  unitMs: number;
  /** Eighth notes per minute (aksak) / beats per minute (even). */
  bpm: number;
  /** Each gap as 2 (short) or 3 (long); even meters: all 1. */
  labels: number[];
  /** Short and long gap averages (ms), for display. */
  shortMs: number;
  longMs: number;
  /** Full cycles heard (rough), for the confidence text. */
  cycles: number;
  /** Turkish explanation for the user. */
  message: string;
}

export const MIN_TAPS = 7;

/** How common each aksak pattern is in türküs (tie-breaker when the taps do not say where the cycle starts). */
const PRIOR: Record<string, number> = {
  '2,3': 1, '3,2': 0.7,
  '3,2,2': 1, '2,2,3': 0.85, '2,3,2': 0.35,
  '2,2,2,3': 1, '3,2,2,2': 0.6, '2,3,2,2': 0.3, '2,2,3,2': 0.3,
  '3,2,2,3': 1, '2,3,2,3': 0.25,
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Gaps between taps, without pauses (a gap far longer than usual means the user stopped). */
export function gapsOf(taps: Tap[]): { gaps: number[]; accentAt: boolean[] } {
  const raw = taps.slice(1).map((x, i) => x.t - taps[i].t);
  const med = median(raw);
  const gaps: number[] = [];
  const accentAt: boolean[] = [];
  raw.forEach((g, i) => {
    if (g > 40 && g < med * 2.6) {
      gaps.push(g);
      // The tap that starts this gap.
      accentAt.push(!!taps[i].accent);
    }
  });
  return { gaps, accentAt };
}

/** Best split of sorted values into two groups (minimum within-group variance). */
export function twoMeans(xs: number[]): { low: number; high: number; split: number } {
  const s = [...xs].sort((a, b) => a - b);
  let best = { cost: Infinity, low: s[0], high: s[s.length - 1], split: s[0] };
  for (let k = 1; k < s.length; k++) {
    const a = s.slice(0, k);
    const b = s.slice(k);
    const ma = a.reduce((x, y) => x + y, 0) / a.length;
    const mb = b.reduce((x, y) => x + y, 0) / b.length;
    const cost = a.reduce((x, y) => x + (y - ma) ** 2, 0) + b.reduce((x, y) => x + (y - mb) ** 2, 0);
    if (cost < best.cost) best = { cost, low: ma, high: mb, split: (s[k - 1] + s[k]) / 2 };
  }
  return best;
}

function fitPattern(labels: number[], groups: number[], offset: number): number {
  let ok = 0;
  labels.forEach((l, i) => {
    if (l === groups[(i + offset) % groups.length]) ok++;
  });
  return ok / labels.length;
}

/** Accent taps vote for the rotation that puts them on the cycle start. */
function accentVote(accentAt: boolean[], groups: number[], offset: number): number {
  let on = 0;
  let total = 0;
  accentAt.forEach((a, i) => {
    if (!a) return;
    total++;
    if ((i + offset) % groups.length === 0) on++;
  });
  return total ? on / total : 0.5;
}

/**
 * `labels`: 2/3 per gap, from the tempo-normalised split. People shorten the
 * long beat when tapping (3:2 becomes ~1.2:1), so the eighth is taken from
 * the short beats only: u = short / 2.
 */
function analyseAksak(gaps: number[], labels: number[], accentAt: boolean[]): MeterResult {
  const shorts = gaps.filter((_, i) => labels[i] === 2);
  const longs = gaps.filter((_, i) => labels[i] === 3);
  const short = median(shorts.length ? shorts : gaps);
  const long = median(longs.length ? longs : gaps);
  const u = short / 2;
  const hasAccents = accentAt.some(Boolean);

  const byMeter = new Map<string, Candidate>();
  for (const def of AKSAK_USULS) {
    const p = def.groups.length;
    // Read the taps as this pattern starting at each possible beat.
    for (let o = 0; o < p; o++) {
      const fit = fitPattern(labels, def.groups, o);
      const prior = PRIOR[def.groups.join(',')] ?? 0.3;
      const vote = accentVote(accentAt, def.groups, o);
      // Fit dominates; accents (when given) decide the start; otherwise how common the usul is.
      const score = fit * (hasAccents ? 0.6 + 0.4 * vote : 0.85 + 0.15 * prior);
      const prev = byMeter.get(def.name);
      if (!prev || score > prev.score) byMeter.set(def.name, { meter: def.meter, name: def.name, groups: def.groups, score, fit });
    }
  }
  // A cycle and its double (2+3 vs 2+3+2+3) fit equally: keep the shorter unless accents prefer the longer.
  const candidates = [...byMeter.values()].sort((a, b) => b.score - a.score || a.groups.length - b.groups.length);
  const best = candidates[0];
  const cycles = labels.length / best.groups.length;
  return {
    kind: best.fit >= 0.8 ? 'aksak' : 'unclear',
    candidates: candidates.slice(0, 4),
    unitMs: u,
    bpm: 60000 / u,
    labels,
    shortMs: short,
    longMs: long,
    cycles,
    message: aksakMessage(best, cycles, labels),
  };
}

function aksakMessage(best: Candidate, cycles: number, labels: number[]): string {
  const seq = labels.slice(0, 12).map((l) => (l === 2 ? 'k' : 'U')).join(' ');
  if (best.fit < 0.8) {
    return `Vuruşlar düzensiz (${seq}…). Biraz daha uzun ve aynı hızda vurmayı deneyin; vurgulu vuruşta DÜM'e basmak yardımcı olur.`;
  }
  const more = cycles < 3 ? ' Daha emin olmak için birkaç döngü daha vurun.' : '';
  return `Topal (uzun) vuruşlar var: ölçü aksak. Duyulan dizi: ${seq}… → ${best.groups.join('+')} = ${best.meter}.${more}`;
}

function analyseEven(gaps: number[], accentAt: boolean[]): MeterResult {
  const beat = median(gaps);
  // Accent spacing (in beats) gives the cycle size; without accents 2/4 and 4/4 cannot be told apart from taps alone.
  const idx = accentAt.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
  const spacing = idx.slice(1).map((v, i) => v - idx[i]);
  const counts = new Map<number, number>();
  for (const s of spacing) counts.set(s, (counts.get(s) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  // Equal taps with DÜM every 5, 7, 9 or 10 taps: the user counted eighth notes of an aksak cycle.
  if (top && [5, 7, 9, 10].includes(top)) return countedEighths(gaps, top, beat);
  if (top === 6) {
    const c: Candidate = { meter: '6/8', name: '6/8 (3+3)', groups: [1, 1, 1, 1, 1, 1], score: 0.9, fit: 1 };
    return { kind: 'even', candidates: [c], unitMs: beat, bpm: 60000 / beat, labels: gaps.map(() => 1), shortMs: beat, longMs: beat, cycles: gaps.length / 6, message: 'Vuruşlar eşit, DÜM her 6 vuruşta bir: 6/8 (iki grup üçlü).' };
  }
  const candidates: Candidate[] = EVEN_METERS.map((m) => {
    const score = top ? (m.beats === top || (top === 4 && m.beats === 2) ? (m.beats === top ? 0.95 : 0.6) : 0.2) : m.beats === 3 ? 0.3 : 0.7;
    return { meter: m.meter, name: m.name, groups: Array(m.beats).fill(1), score, fit: 1 };
  }).sort((a, b) => b.score - a.score);
  const msg = top
    ? `Vuruşlar eşit uzunlukta: ölçü düz. Vurgulu vuruş her ${top} vuruşta bir → ${candidates[0].meter}.`
    : 'Vuruşlarınız eşit çıktı, yani düz ölçü (2/4 ya da 4/4) gibi. Türkü size aksak (topal) geliyorsa: topal vuruşu biraz bekleterek vurun, ya da her sekizliği sayarak vurup döngünün ilk vuruşunda DÜM\'e basın.';
  return {
    kind: 'even',
    candidates,
    unitMs: beat,
    bpm: 60000 / beat,
    labels: gaps.map(() => 1),
    shortMs: beat,
    longMs: beat,
    cycles: top ? gaps.length / top : gaps.length / 4,
    message: msg,
  };
}

/** The user tapped every eighth note and DÜM on each cycle start: the cycle length is known, the inner grouping is not. */
function countedEighths(gaps: number[], eighths: number, eighth: number): MeterResult {
  const defs = AKSAK_USULS.filter((d) => d.groups.reduce((a, b) => a + b, 0) === eighths);
  const candidates: Candidate[] = defs
    .map((d) => ({ meter: d.meter, name: d.name, groups: d.groups, score: 0.6 + 0.35 * (PRIOR[d.groups.join(',')] ?? 0.3), fit: 1 }))
    .sort((a, b) => b.score - a.score);
  return {
    kind: 'aksak',
    candidates,
    unitMs: eighth,
    bpm: 60000 / eighth,
    labels: gaps.map(() => 1),
    shortMs: eighth,
    longMs: eighth,
    cycles: gaps.length / eighths,
    message: `Her sekizliği saymışsınız: DÜM'ler arası ${eighths} sekizlik → ${eighths}/8. Sekizliklerin nasıl gruplandığı (ör. 2+2+2+3) eşit vuruşlardan anlaşılmaz; en yaygını gösterildi, altındakileri dinleyerek karşılaştırın.`,
  };
}

/**
 * Each gap divided by the short-beat level of its neighbourhood (30th
 * percentile): tempo drift cancels while long/short stays ~1.5. A median
 * would not do: with half of the beats long (5/8, 10/8) it falls between
 * short and long and squeezes the difference.
 */
export function normalise(gaps: number[], half = 6): number[] {
  return gaps.map((g, i) => {
    const w = gaps.slice(Math.max(0, i - half), i + half + 1).sort((a, b) => a - b);
    return g / w[Math.floor((w.length - 1) * 0.3)];
  });
}

/** Meter from the taps; undefined until there are enough of them. */
export function analyseTaps(taps: Tap[]): MeterResult | undefined {
  if (taps.length < MIN_TAPS) return undefined;
  const { gaps, accentAt } = gapsOf(taps);
  if (gaps.length < MIN_TAPS - 1) return undefined;
  const norm = normalise(gaps);
  const { low, high, split } = twoMeans(norm);
  const ratio = high / low;
  const labels = norm.map((g) => (g < split ? 2 : 3));
  const lowShare = labels.filter((l) => l === 2).length / labels.length;
  // Two beat lengths, each used often enough, in a pattern that repeats every cycle. A clear 1.5×
  // difference needs little proof; a shortened one (tappers often play 3:2 as ~1.2:1) must repeat cleanly.
  if (ratio >= 1.08 && ratio <= 2.1 && lowShare >= 0.15 && lowShare <= 0.9) {
    const ak = analyseAksak(gaps, labels, accentAt);
    const fit = ak.candidates[0].fit;
    const cycles = gaps.length / ak.candidates[0].groups.length;
    if (ratio >= 1.25 ? fit >= 0.75 : fit >= (gaps.length >= 20 ? 0.8 : 0.88) && cycles >= 3 && gaps.length >= 7) return ak;
    // Two clearly different lengths that do not repeat: say so; a smaller difference is just uneven tapping of an even meter.
    if (ratio >= 1.35) return ak;
  }
  return analyseEven(gaps, accentAt);
}

/** Click times (ms from start) for listening back: one cycle of the usul at the found tempo. */
export function cycleClicks(groups: number[], unitMs: number): { at: number; strong: boolean }[] {
  const out: { at: number; strong: boolean }[] = [];
  let t = 0;
  groups.forEach((g, i) => {
    out.push({ at: t, strong: i === 0 });
    t += g * unitMs;
  });
  return out;
}

export function cycleLength(groups: number[], unitMs: number): number {
  return groups.reduce((a, b) => a + b, 0) * unitMs;
}

export { rotate, type UsulDef };

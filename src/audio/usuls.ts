// Pure metronome model: Turkish usuls and meters (aksak groupings with
// dum/tek strokes), accent marks and the per-bar click plan.

export type Unit = 2 | 4 | 8 | 16;
export type Stroke = 'D' | 'T' | 'K';
export type Mark = 'accent' | 'normal' | 'mute';
export type Level = 'bar' | 'group' | 'beat' | 'sub';
export type Subdivision = 1 | 2 | 3 | 4;
export type SoundId = 'klasik' | 'bip' | 'darbuka' | 'davul' | 'def' | 'bateri';

export interface Usul {
  id: string;
  name: string;
  beats: number;
  unit: Unit;
  /** Aksak grouping in pulses (sums to beats). */
  grouping: number[];
  /** One char per pulse: D düm, T tek, K ka, - rest. */
  pattern: string;
}

export const USULS: Usul[] = [
  { id: 'nim-sofyan', name: 'Nim sofyan', beats: 2, unit: 4, grouping: [1, 1], pattern: 'DT' },
  { id: 'semai', name: 'Semai', beats: 3, unit: 4, grouping: [1, 1, 1], pattern: 'DTT' },
  { id: 'sofyan', name: 'Sofyan', beats: 4, unit: 4, grouping: [1, 1, 1, 1], pattern: 'D-TK' },
  { id: 'turk-aksagi', name: 'Türk aksağı', beats: 5, unit: 8, grouping: [2, 3], pattern: 'D-T-T' },
  { id: 'aksak-5-3-2', name: '5/8 (3+2)', beats: 5, unit: 8, grouping: [3, 2], pattern: 'D-KT-' },
  { id: 'yuruk-semai', name: 'Yürük semai', beats: 6, unit: 8, grouping: [3, 3], pattern: 'D-TDT-' },
  { id: 'devr-i-hindi', name: 'Devr-i hindi', beats: 7, unit: 8, grouping: [3, 2, 2], pattern: 'D-TD-T-' },
  { id: 'aksak-7-2-2-3', name: '7/8 (2+2+3)', beats: 7, unit: 8, grouping: [2, 2, 3], pattern: 'D-T-D-T' },
  { id: 'laz', name: 'Laz horonu', beats: 7, unit: 16, grouping: [2, 2, 3], pattern: 'D-T-T-K' },
  { id: 'duyek', name: 'Düyek', beats: 8, unit: 8, grouping: [2, 1, 2, 1, 2], pattern: 'DT-TD-T-' },
  { id: 'ciftetelli', name: 'Çiftetelli', beats: 8, unit: 8, grouping: [3, 3, 2], pattern: 'D-TD-TT-' },
  { id: 'aksak', name: 'Aksak', beats: 9, unit: 8, grouping: [2, 2, 2, 3], pattern: 'D-T-D-T-K' },
  { id: 'roman', name: 'Roman havası', beats: 9, unit: 8, grouping: [2, 2, 2, 3], pattern: 'D-T-T-D-T' },
  { id: 'aksak-semai', name: 'Aksak semai', beats: 10, unit: 8, grouping: [3, 2, 2, 3], pattern: 'D-KT-D-T-K' },
  { id: 'curcuna', name: 'Curcuna', beats: 10, unit: 16, grouping: [3, 2, 2, 3], pattern: 'D-TD-T-T-K' },
  { id: 'agir-aksak-12', name: '12/8 (3+3+3+3)', beats: 12, unit: 8, grouping: [3, 3, 3, 3], pattern: 'D-KT-KD-KT-K' },
];

export const MAX_BEATS = 16;
export const UNITS: Unit[] = [2, 4, 8, 16];

export const usulById = (id: string): Usul | undefined => USULS.find((u) => u.id === id);

export function validGrouping(beats: number, grouping: readonly number[] | undefined): number[] {
  if (grouping && grouping.length && grouping.every((g) => Number.isInteger(g) && g > 0) && grouping.reduce((a, b) => a + b, 0) === beats) {
    return [...grouping];
  }
  return Array.from({ length: beats }, () => 1);
}

export const isGrouped = (g: readonly number[]): boolean => g.some((x) => x > 1);

export function groupStarts(beats: number, grouping: readonly number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const g of validGrouping(beats, grouping)) {
    out.push(acc);
    acc += g;
  }
  return out;
}

/** Bar start and every group start accented (even meters: only beat 1). */
export function defaultMarks(beats: number, grouping: readonly number[]): Mark[] {
  const g = validGrouping(beats, grouping);
  const starts = new Set(isGrouped(g) ? groupStarts(beats, g) : [0]);
  return Array.from({ length: beats }, (_, i) => (starts.has(i) ? 'accent' : 'normal'));
}

export const cycleMark = (m: Mark): Mark => (m === 'accent' ? 'normal' : m === 'normal' ? 'mute' : 'accent');

/** Every split of `beats` into 2s and 3s (for the grouping picker). */
export function groupingOptions(beats: number, limit = 16): number[][] {
  const out: number[][] = [];
  const walk = (left: number, acc: number[]): void => {
    if (out.length >= limit) return;
    if (left === 0) {
      if (acc.length > 1) out.push(acc);
      return;
    }
    for (const g of [2, 3]) if (g <= left) walk(left - g, [...acc, g]);
  };
  if (beats >= 4) walk(beats, []);
  return out;
}

export const meterLabel = (beats: number, unit: Unit, grouping: readonly number[]): string =>
  `${beats}/${unit}${isGrouped(grouping) ? ` (${grouping.join('+')})` : ''}`;

export interface MetroSettings {
  /** Pulses (unit notes) per minute. */
  bpm: number;
  usulId: string;
  beats: number;
  unit: Unit;
  grouping: number[];
  marks: Mark[];
  sound: SoundId;
  /** Play the usul's dum/tek strokes instead of plain clicks. */
  strokes: boolean;
  subdivision: Subdivision;
  volume: number;
  /** Tempo follows the rhythm player (times `factor`). */
  follow: boolean;
  factor: 0.5 | 1 | 2;
  /** START/STOP of the rhythm also starts/stops the metronome. */
  withRhythm: boolean;
}

export const DEFAULT_METRO: MetroSettings = {
  bpm: 100,
  usulId: '',
  beats: 4,
  unit: 4,
  grouping: [1, 1, 1, 1],
  marks: defaultMarks(4, [1, 1, 1, 1]),
  sound: 'klasik',
  strokes: false,
  subdivision: 1,
  volume: 0.8,
  follow: false,
  factor: 1,
  withRhythm: false,
};

export function withMeter(s: MetroSettings, beats: number, unit: Unit, grouping?: readonly number[], usulId = ''): MetroSettings {
  const b = Math.max(1, Math.min(MAX_BEATS, Math.round(beats)));
  const g = validGrouping(b, grouping);
  return { ...s, beats: b, unit, grouping: g, marks: defaultMarks(b, g), usulId, strokes: usulId ? s.strokes : false };
}

export const withUsul = (s: MetroSettings, u: Usul): MetroSettings => ({ ...withMeter(s, u.beats, u.unit, u.grouping, u.id), strokes: true });

/**
 * Metronome meter for a rhythm meter like "9/8" (the matching usul when there
 * is one). Recorded tempos are quarter notes (Pa5X), so x/8 clicks twice as fast.
 */
export function meterForRhythm(s: MetroSettings, meter: string | undefined): MetroSettings {
  const m = /^(\d{1,2})\/(2|4|8|16)$/.exec(meter ?? '');
  if (!m) return s;
  const beats = Number(m[1]);
  const unit = Number(m[2]) as Unit;
  const factor = unit === 8 ? 2 : 1;
  if (beats === s.beats && unit === s.unit) return { ...s, factor };
  const u = USULS.find((x) => x.beats === beats && x.unit === unit);
  return { ...(u ? { ...withUsul(s, u), strokes: s.strokes } : withMeter(s, beats, unit)), factor };
}

const SOUNDS: SoundId[] = ['klasik', 'bip', 'darbuka', 'davul', 'def', 'bateri'];
const num = (v: unknown, d: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;

export function sanitizeMetro(raw: unknown): MetroSettings {
  const d = DEFAULT_METRO;
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const beats = Math.round(num(r.beats, d.beats, 1, MAX_BEATS));
  const unit = UNITS.includes(r.unit as Unit) ? (r.unit as Unit) : d.unit;
  const grouping = validGrouping(beats, Array.isArray(r.grouping) ? (r.grouping as number[]) : undefined);
  const marks =
    Array.isArray(r.marks) && r.marks.length === beats && r.marks.every((m) => m === 'accent' || m === 'normal' || m === 'mute')
      ? (r.marks as Mark[])
      : defaultMarks(beats, grouping);
  const usul = typeof r.usulId === 'string' ? usulById(r.usulId) : undefined;
  const usulOk = usul && usul.beats === beats && usul.unit === unit;
  return {
    bpm: Math.round(num(r.bpm, d.bpm, 30, 300)),
    usulId: usulOk ? usul.id : '',
    beats,
    unit,
    grouping,
    marks,
    sound: SOUNDS.includes(r.sound as SoundId) ? (r.sound as SoundId) : d.sound,
    strokes: usulOk ? r.strokes === true : false,
    subdivision: ([1, 2, 3, 4] as const).find((x) => x === r.subdivision) ?? 1,
    volume: num(r.volume, d.volume, 0, 1),
    follow: r.follow === true,
    factor: r.factor === 0.5 || r.factor === 2 ? r.factor : 1,
    withRhythm: r.withRhythm === true,
  };
}

export interface PlanEvent {
  /** Position in pulses from the bar start. */
  at: number;
  beat: number;
  level: Level;
  stroke?: Stroke;
  /** Visual marker only (muted pulse or usul rest). */
  silent?: boolean;
}

/** Events of one bar: usul strokes, or clicks with accents and subdivisions. */
export function planBar(s: Pick<MetroSettings, 'beats' | 'grouping' | 'marks' | 'subdivision' | 'strokes' | 'usulId'>): PlanEvent[] {
  const marks = s.marks.length === s.beats ? s.marks : defaultMarks(s.beats, s.grouping);
  const levelOf = (i: number): Level => (i === 0 ? 'bar' : marks[i] === 'accent' ? 'group' : 'beat');
  const usul = s.strokes ? usulById(s.usulId) : undefined;
  const out: PlanEvent[] = [];
  for (let beat = 0; beat < s.beats; beat++) {
    const muted = marks[beat] === 'mute';
    if (usul && usul.pattern.length === s.beats) {
      const c = usul.pattern[beat];
      const stroke = c === 'D' || c === 'T' || c === 'K' ? c : undefined;
      out.push({ at: beat, beat, level: levelOf(beat), stroke: muted ? undefined : stroke, silent: muted || !stroke });
      continue;
    }
    out.push({ at: beat, beat, level: levelOf(beat), silent: muted || undefined });
    if (muted) continue;
    for (let sub = 1; sub < s.subdivision; sub++) out.push({ at: beat + sub / s.subdivision, beat, level: 'sub' });
  }
  return out;
}

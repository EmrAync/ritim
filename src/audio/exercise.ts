// Pure metronome exercise programs: the tempo of every bar and whether it is
// a silent "inner tempo" bar. The engine asks at each bar line.

export type ExerciseKind = 'adim' | 'sure' | 'piramit' | 'aralik';

export interface ExerciseSettings {
  on: boolean;
  kind: ExerciseKind;
  /** First tempo (BPM). */
  start: number;
  /** Tempo to reach (lower than start = slow down). */
  target: number;
  /** BPM per step (adim, piramit). */
  step: number;
  /** Bars per step / per half of an interval. */
  everyBars: number;
  /** Minutes the gradual change takes (sure). */
  rampMin: number;
  /** Stop after this many minutes (0 = until STOP). */
  totalMin: number;
  /** Inner tempo: play `playBars`, then `muteBars` silent bars. */
  gap: boolean;
  playBars: number;
  muteBars: number;
}

export const EXERCISE_KINDS: { id: ExerciseKind; label: string; hint: string }[] = [
  { id: 'adim', label: 'Adım adım', hint: 'Her birkaç ölçüde tempo biraz değişir, hedefte kalır.' },
  { id: 'sure', label: 'Süreye yay', hint: 'Tempo seçilen dakika boyunca yavaş yavaş hedefe gider.' },
  { id: 'piramit', label: 'Piramit', hint: 'Hedefe çıkar, sonra başlangıca iner; tekrar eder.' },
  { id: 'aralik', label: 'Hızlı–yavaş', hint: 'Başlangıç ve hedef tempo sırayla çalınır.' },
];

export const DEFAULT_EXERCISE: ExerciseSettings = {
  on: false,
  kind: 'adim',
  start: 80,
  target: 120,
  step: 4,
  everyBars: 4,
  rampMin: 5,
  totalMin: 0,
  gap: false,
  playBars: 4,
  muteBars: 2,
};

export const EXERCISE_PRESETS: { label: string; set: Partial<ExerciseSettings> }[] = [
  { label: 'Isınma', set: { kind: 'adim', start: 60, target: 100, step: 4, everyBars: 4, gap: false } },
  { label: 'Hız çalışması', set: { kind: 'adim', start: 80, target: 140, step: 2, everyBars: 2, gap: false } },
  { label: 'Yavaşlama', set: { kind: 'adim', start: 120, target: 70, step: 5, everyBars: 4, gap: false } },
  { label: '5 dk hızlan', set: { kind: 'sure', start: 70, target: 110, rampMin: 5, gap: false } },
  { label: 'Piramit', set: { kind: 'piramit', start: 80, target: 120, step: 4, everyBars: 2, gap: false } },
  { label: 'Hızlı–yavaş', set: { kind: 'aralik', start: 90, target: 130, everyBars: 4, gap: false } },
  { label: 'İç tempo', set: { kind: 'adim', start: 90, target: 90, gap: true, playBars: 4, muteBars: 4 } },
];

const clampBpm = (v: number): number => Math.max(30, Math.min(300, Math.round(v)));

/** Tempo of the bar after `bars` complete bars, `sec` seconds after the start. */
export function exerciseTempo(ex: ExerciseSettings, bars: number, sec: number): number {
  const start = clampBpm(ex.start);
  const target = clampBpm(ex.target);
  const dir = Math.sign(target - start);
  const span = Math.abs(target - start);
  const step = Math.max(1, ex.step);
  const every = Math.max(1, Math.round(ex.everyBars));
  const n = Math.floor(Math.max(0, bars) / every);
  switch (ex.kind) {
    case 'adim':
      return clampBpm(start + dir * Math.min(span, n * step));
    case 'sure': {
      const frac = ex.rampMin > 0 ? Math.min(1, Math.max(0, sec) / (ex.rampMin * 60)) : 1;
      return clampBpm(start + (target - start) * frac);
    }
    case 'piramit': {
      const up = Math.ceil(span / step);
      if (!up) return start;
      const m = n % (2 * up);
      const k = m <= up ? m : 2 * up - m;
      return clampBpm(start + dir * Math.min(span, k * step));
    }
    case 'aralik':
      return n % 2 === 0 ? start : target;
  }
}

/** True when the bar after `bars` complete bars is a silent inner-tempo bar. */
export function exerciseMuted(ex: ExerciseSettings, bars: number): boolean {
  if (!ex.gap) return false;
  const play = Math.max(1, Math.round(ex.playBars));
  const mute = Math.max(0, Math.round(ex.muteBars));
  return mute > 0 && bars % (play + mute) >= play;
}

const num = (v: unknown, d: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;

export function sanitizeExercise(raw: unknown): ExerciseSettings {
  const d = DEFAULT_EXERCISE;
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  return {
    on: r.on === true,
    kind: EXERCISE_KINDS.some((k) => k.id === r.kind) ? (r.kind as ExerciseKind) : d.kind,
    start: num(r.start, d.start, 30, 300),
    target: num(r.target, d.target, 30, 300),
    step: num(r.step, d.step, 1, 40),
    everyBars: num(r.everyBars, d.everyBars, 1, 64),
    rampMin: num(r.rampMin, d.rampMin, 1, 120),
    totalMin: num(r.totalMin, d.totalMin, 0, 240),
    gap: r.gap === true,
    playBars: num(r.playBars, d.playBars, 1, 32),
    muteBars: num(r.muteBars, d.muteBars, 0, 32),
  };
}

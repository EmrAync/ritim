import { describe, expect, it } from 'vitest';
import { DEFAULT_EXERCISE, exerciseMuted, exerciseTempo, sanitizeExercise } from '../src/audio/exercise';

const ex = (p: Partial<typeof DEFAULT_EXERCISE>) => ({ ...DEFAULT_EXERCISE, on: true, ...p });

describe('exercise', () => {
  it('steps up every N bars and stays at the target', () => {
    const e = ex({ kind: 'adim', start: 80, target: 90, step: 4, everyBars: 2 });
    expect([0, 1, 2, 3, 4, 6, 20].map((b) => exerciseTempo(e, b, 0))).toEqual([80, 80, 84, 84, 88, 90, 90]);
  });

  it('slows down when the target is lower', () => {
    const e = ex({ kind: 'adim', start: 120, target: 100, step: 5, everyBars: 1 });
    expect([0, 1, 2, 4, 9].map((b) => exerciseTempo(e, b, 0))).toEqual([120, 115, 110, 100, 100]);
  });

  it('ramps over time', () => {
    const e = ex({ kind: 'sure', start: 60, target: 120, rampMin: 2 });
    expect(exerciseTempo(e, 0, 0)).toBe(60);
    expect(exerciseTempo(e, 0, 60)).toBe(90);
    expect(exerciseTempo(e, 0, 500)).toBe(120);
  });

  it('pyramid goes up and back down; interval alternates', () => {
    const p = ex({ kind: 'piramit', start: 80, target: 88, step: 4, everyBars: 1 });
    expect([0, 1, 2, 3, 4, 5].map((b) => exerciseTempo(p, b, 0))).toEqual([80, 84, 88, 84, 80, 84]);
    const a = ex({ kind: 'aralik', start: 90, target: 130, everyBars: 2 });
    expect([0, 1, 2, 3, 4].map((b) => exerciseTempo(a, b, 0))).toEqual([90, 90, 130, 130, 90]);
  });

  it('leaves bars silent for the inner-tempo drill and sanitizes stored data', () => {
    const g = ex({ gap: true, playBars: 2, muteBars: 1 });
    expect([0, 1, 2, 3, 4, 5].map((b) => exerciseMuted(g, b))).toEqual([false, false, true, false, false, true]);
    expect(exerciseMuted(ex({ gap: false }), 2)).toBe(false);
    const s = sanitizeExercise({ on: 'yes', kind: 'x', start: 9999, step: 0 });
    expect([s.on, s.kind, s.start, s.step]).toEqual([false, 'adim', 300, 1]);
  });
});

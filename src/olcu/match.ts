// From a found meter to the app's rhythms: which rhythms are in that meter,
// and at what tempo to start them (the app's tempos are quarter notes).

import type { Rhythm } from '../data/rhythms';
import type { Candidate, MeterResult } from './meter';

/** "9/8" → 8 (the note value of one count). */
export const unitOf = (meter: string): number => Number(meter.split('/')[1]) || 4;

/**
 * Quarter-note BPM for the found tempo. The analysis gives eighths per minute
 * for x/8 meters (aksak, counted eighths, 6/8) and beats per minute for even
 * x/4 meters (each tap a quarter).
 */
export function quarterBpm(result: MeterResult, c: Candidate): number {
  return Math.round(unitOf(c.meter) === 8 ? result.bpm / 2 : result.bpm);
}

/** The app's rhythms in this meter (the drones without a meter are left out). */
export function rhythmsInMeter(all: readonly Rhythm[], meter: string): Rhythm[] {
  return all.filter((r) => r.meter === meter && !r.whole);
}

/** Click pattern for listening back: one strong click per cycle start, one per beat. */
export function listenPattern(result: MeterResult, c: Candidate): { at: number; strong: boolean }[] {
  const out: { at: number; strong: boolean }[] = [];
  let t = 0;
  c.groups.forEach((g, i) => {
    out.push({ at: t, strong: i === 0 });
    t += g * result.unitMs;
  });
  return out;
}

export const cycleMs = (result: MeterResult, c: Candidate): number => c.groups.reduce((a, b) => a + b, 0) * result.unitMs;

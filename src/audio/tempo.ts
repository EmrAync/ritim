// Pure tempo helpers: playback rate limits and tap tempo.

export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
export const MIN_BPM = 30;
export const MAX_BPM = 300;

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Tempo range a rhythm recorded at `rec` can be played at without sounding unnatural. */
export function tempoRange(rec: number | undefined): [number, number] {
  if (!rec) return [MIN_BPM, MAX_BPM];
  return [Math.max(MIN_BPM, Math.ceil(rec * MIN_RATE)), Math.min(MAX_BPM, Math.floor(rec * MAX_RATE))];
}

export function rateFor(rec: number | undefined, target: number): number {
  if (!rec) return 1;
  return clamp(target / rec, MIN_RATE, MAX_RATE);
}

/**
 * Tap tempo: average of the recent intervals; a pause longer than `resetMs`
 * starts a new measurement. Returns undefined until two taps are in.
 */
export class TapTempo {
  private taps: number[] = [];
  constructor(private readonly resetMs = 2000, private readonly keep = 6) {}

  tap(now: number): number | undefined {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && now - last > this.resetMs) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > this.keep) this.taps.shift();
    if (this.taps.length < 2) return undefined;
    const span = this.taps[this.taps.length - 1] - this.taps[0];
    const bpm = (60000 * (this.taps.length - 1)) / span;
    return Math.round(clamp(bpm, MIN_BPM, MAX_BPM));
  }

  get count(): number {
    return this.taps.length;
  }
}

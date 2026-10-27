// Pure playback timeline: which loop position is heard at a given audio time
// while the tempo changes, and where the next beat-grid point falls. Shared
// by the rhythm player (progress) and the metronome (locked clicks).

export interface Segment {
  /** Audio-context time this segment starts being heard. */
  t: number;
  /** Loop position (s) heard at `t`. */
  p: number;
  rate: number;
}

export const mod = (x: number, m: number): number => ((x % m) + m) % m;

export class Timeline {
  private segs: Segment[] = [];
  constructor(public loopLen = 0) {}

  reset(t: number, p: number, rate: number, loopLen = this.loopLen): void {
    this.loopLen = loopLen;
    this.segs = [{ t, p, rate }];
  }

  get started(): boolean {
    return this.segs.length > 0;
  }

  get lastT(): number {
    return this.segs.length ? this.segs[this.segs.length - 1].t : 0;
  }

  /** Tempo change heard from `t` on (t must not be before the last change). */
  change(t: number, rate: number): void {
    if (!this.segs.length) return;
    const p = this.posAt(t);
    this.segs.push({ t, p, rate });
    // Keep the history short: anything a second older than this change is past.
    while (this.segs.length > 2 && this.segs[1].t < t - 1) this.segs.shift();
  }

  segmentAt(t: number): Segment | undefined {
    let s: Segment | undefined;
    for (const x of this.segs) {
      if (x.t <= t) s = x;
      else break;
    }
    return s ?? this.segs[0];
  }

  /** Loop position (0…loopLen) heard at audio time `t`. */
  posAt(t: number): number {
    const s = this.segmentAt(t);
    if (!s || this.loopLen <= 0) return 0;
    const raw = s.p + Math.max(0, t - s.t) * s.rate;
    return mod(raw, this.loopLen);
  }

  rateAt(t: number): number {
    return this.segmentAt(t)?.rate ?? 1;
  }

  /** Time of the first tempo change after t (undefined when none is scheduled). */
  nextChange(t: number): number | undefined {
    return this.segs.find((s) => s.t > t)?.t;
  }
}

export interface GridHit {
  /** Grid index from the loop start (may be negative before the first downbeat). */
  k: number;
  /** Loop position of the hit. */
  pos: number;
  /** Loop distance from the query position (wraps over the loop end). */
  dist: number;
}

/**
 * Next point at or after `x` of the grid phase + k·step inside a loop of
 * length L. After the loop end the grid starts again from the loop start,
 * just like the recording does.
 */
export function nextGridPoint(x: number, L: number, phase: number, step: number): GridHit {
  const k = Math.ceil((x - phase) / step - 1e-9) + 0; // + 0: no -0
  const pos = phase + k * step;
  if (pos < L) return { k, pos, dist: pos - x };
  const k0 = Math.ceil((0 - phase) / step - 1e-9) + 0;
  const pos0 = phase + k0 * step;
  return { k: k0, pos: pos0, dist: L - x + pos0 };
}

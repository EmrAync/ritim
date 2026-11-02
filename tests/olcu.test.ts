import { describe, expect, it } from 'vitest';
import { analyseTaps, cycleClicks, twoMeans, type Tap } from '../src/olcu/meter';

/** Taps for `cycles` cycles of `groups` (eighths per beat), with human timing jitter and a slow drift. */
function taps(groups: number[], eighthMs: number, cycles: number, opts: { jitter?: number; accents?: boolean; startBeat?: number; seed?: number } = {}): Tap[] {
  let seed = opts.seed ?? 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const out: Tap[] = [];
  let t = 1000;
  const start = opts.startBeat ?? 0;
  const n = groups.length * cycles;
  for (let i = 0; i < n; i++) {
    const k = (i + start) % groups.length;
    out.push({ t: t + rnd() * (opts.jitter ?? 0) * eighthMs, accent: opts.accents ? k === 0 : undefined });
    const drift = 1 + (0.06 * i) / n;
    t += groups[k] * eighthMs * drift;
  }
  return out;
}

describe('ölçü bulucu', () => {
  it('splits gaps into short and long', () => {
    const r = twoMeans([200, 210, 300, 195, 305, 205]);
    expect(Math.round(r.low)).toBe(203);
    expect(Math.round(r.high)).toBe(303);
  });

  it('finds 9/8 Karşılama (2+2+2+3) from plain taps with timing errors', () => {
    const r = analyseTaps(taps([2, 2, 2, 3], 130, 5, { jitter: 0.25 }))!;
    expect(r.kind).toBe('aksak');
    expect(r.candidates[0].meter).toBe('9/8');
    expect(r.candidates[0].groups).toEqual([2, 2, 2, 3]);
    expect(Math.round(r.bpm / 10) * 10).toBeGreaterThan(400);
  });

  it('uses DÜM accents to find where the cycle starts (3+2+2+2)', () => {
    const r = analyseTaps(taps([3, 2, 2, 2], 120, 5, { jitter: 0.2, accents: true, startBeat: 1 }))!;
    expect(r.candidates[0].groups).toEqual([3, 2, 2, 2]);
  });

  it('finds 7/8 and 5/8', () => {
    expect(analyseTaps(taps([3, 2, 2], 150, 6, { jitter: 0.2 }))!.candidates[0].groups).toEqual([3, 2, 2]);
    expect(analyseTaps(taps([2, 3], 160, 8, { jitter: 0.2 }))!.candidates[0].meter).toBe('5/8');
    expect(analyseTaps(taps([2, 2, 3], 140, 6, { jitter: 0.15, accents: true }))!.candidates[0].groups).toEqual([2, 2, 3]);
  });

  it('finds 10/8 aksak semai with accents', () => {
    const r = analyseTaps(taps([3, 2, 2, 3], 140, 5, { jitter: 0.15, accents: true }))!;
    expect(r.candidates[0].meter).toBe('10/8');
  });

  it('says even for equal beats, and 4/4 when every fourth beat is accented', () => {
    const plain = analyseTaps(taps([2, 2, 2, 2], 250, 4, { jitter: 0.15 }))!;
    expect(plain.kind).toBe('even');
    expect(Math.round(plain.bpm)).toBeGreaterThan(100);
    const acc = analyseTaps(taps([2, 2, 2, 2], 250, 4, { jitter: 0.1, accents: true }))!;
    expect(acc.candidates[0].meter).toBe('4/4');
    const two = analyseTaps(taps([2, 2], 250, 8, { jitter: 0.1, accents: true }))!;
    expect(two.candidates[0].meter).toBe('2/4');
  });

  it('waits for enough taps and ignores a pause', () => {
    expect(analyseTaps(taps([2, 2, 2, 3], 130, 1))).toBeUndefined();
    const t = taps([2, 2, 2, 3], 130, 4, { jitter: 0.1 });
    for (const x of t.slice(8)) x.t += 4000;
    expect(analyseTaps(t)!.candidates[0].meter).toBe('9/8');
  });

  it('clicks one cycle at the found tempo', () => {
    expect(cycleClicks([2, 2, 2, 3], 100)).toEqual([
      { at: 0, strong: true },
      { at: 200, strong: false },
      { at: 400, strong: false },
      { at: 600, strong: false },
    ]);
  });
});

/** Taps as people really play them: the long beat shortened to `ratio` × the short one. */
function humanTaps(groups: number[], shortMs: number, cycles: number, ratio: number, jitter: number, opts: { accents?: boolean; seed?: number } = {}): Tap[] {
  let seed = opts.seed ?? 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const out: Tap[] = [];
  let t = 500;
  for (let i = 0; i < groups.length * cycles; i++) {
    const g = groups[i % groups.length];
    out.push({ t: t + rnd() * jitter * shortMs, accent: opts.accents ? i % groups.length === 0 : undefined });
    t += g === 3 ? shortMs * ratio : shortMs;
  }
  return out;
}

describe('gerçek vuruşlar (topal vuruş kısaltılmış)', () => {
  it('still finds aksak when the long beat is only 1.2–1.3× the short one', () => {
    expect(analyseTaps(humanTaps([2, 2, 2, 3], 260, 6, 1.25, 0.05))!.candidates[0].groups).toEqual([2, 2, 2, 3]);
    expect(analyseTaps(humanTaps([3, 2, 2], 280, 6, 1.2, 0.05))!.candidates[0].groups).toEqual([3, 2, 2]);
    expect(analyseTaps(humanTaps([2, 3], 300, 8, 1.3, 0.05))!.candidates[0].meter).toBe('5/8');
    expect(analyseTaps(humanTaps([3, 2, 2, 3], 280, 5, 1.2, 0.05))!.candidates[0].meter).toBe('10/8');
  });

  it('keeps even taps even, also with sloppy timing', () => {
    for (const seed of [1, 2, 3, 4, 5]) expect(analyseTaps(humanTaps([2, 2, 2, 2], 400, 5, 1, 0.12, { seed }))!.kind).toBe('even');
  });

  it('reads counted eighths (equal taps, DÜM every 9) as 9/8', () => {
    const r = analyseTaps(humanTaps(Array(9).fill(2), 140, 3, 1, 0.05, { accents: true }))!;
    expect(r.candidates[0].meter).toBe('9/8');
    expect(r.message).toContain('sekizliği');
  });
});

import { quarterBpm, rhythmsInMeter } from '../src/olcu/match';
import type { Rhythm } from '../src/data/rhythms';

describe('ölçü → uygulamanın ritimleri', () => {
  const r = (id: string, meter?: string, whole = false): Rhythm => ({ id, title: id, category: '', meter, file: '', duration: 1, size: 1, whole });
  it('lists the rhythms of the found meter', () => {
    const all = [r('a', '9/8'), r('b', '2/4'), r('c', '9/8', true), r('d')];
    expect(rhythmsInMeter(all, '9/8').map((x) => x.id)).toEqual(['a']);
  });

  it('converts the found tempo to quarter notes', () => {
    const res = analyseTaps(taps([2, 2, 2, 3], 125, 5))!; // eighth = 125 ms → 480 eighths/min
    // The helper slows the taps by up to 6 % (human drift).
    expect(Math.abs(quarterBpm(res, res.candidates[0]) - 240)).toBeLessThanOrEqual(14);
    const even = analyseTaps(taps([1, 1], 600, 8))!; // a beat every 600 ms → 100 BPM
    expect(Math.abs(quarterBpm(even, even.candidates[0]) - 100)).toBeLessThanOrEqual(6);
  });
});

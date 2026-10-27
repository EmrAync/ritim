import { describe, expect, it } from 'vitest';
import { Timeline, nextGridPoint } from '../src/audio/timeline';

describe('timeline', () => {
  it('follows tempo changes and wraps at the loop end', () => {
    const tl = new Timeline();
    tl.reset(10, 0, 1, 100);
    expect(tl.posAt(9)).toBe(0);
    expect(tl.posAt(15)).toBeCloseTo(5);
    tl.change(20, 2);
    expect(tl.posAt(20)).toBeCloseTo(10);
    expect(tl.posAt(25)).toBeCloseTo(20);
    expect(tl.posAt(65)).toBeCloseTo(0); // 10 + 45·2 = 100 → wrapped
    expect(tl.rateAt(30)).toBe(2);
  });

  it('finds the next grid point, restarting the grid after the wrap', () => {
    // Grid 0.2 + k·0.5 in a 2.0 s loop: 0.2, 0.7, 1.2, 1.7 (and -0.3 before the loop start).
    expect(nextGridPoint(0.5, 2, 0.2, 0.5)).toMatchObject({ k: 1, pos: 0.7 });
    expect(nextGridPoint(0, 2, 0.2, 0.5)).toMatchObject({ k: 0, pos: 0.2 });
    const wrap = nextGridPoint(1.8, 2, 0.7, 0.5); // 1.7 passed, next would be 2.2 → wraps to 0.2 (k = -1)
    expect(wrap.k).toBe(-1);
    expect(wrap.pos).toBeCloseTo(0.2);
    expect(wrap.dist).toBeCloseTo(0.4);
  });
});

import { describe, expect, it } from 'vitest';
import { TUNINGS, detectPitch, detectPitchFine, matchString, median, noteName, octaveOf, readNote } from '../src/audio/pitch';

/** A plucked-string-like tone: fundamental plus decaying harmonics. */
function tone(freq: number, sr: number, n: number, harmonics = [1, 0.6, 0.35, 0.2]): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    harmonics.forEach((a, h) => (s += a * Math.sin((2 * Math.PI * freq * (h + 1) * i) / sr)));
    out[i] = 0.3 * s;
  }
  return out;
}

describe('pitch', () => {
  it('finds the fundamental of guitar and bağlama strings within 1 cent', () => {
    for (const f of [82.41, 110, 146.83, 196, 246.94, 329.63, 440, 587.33, 880]) {
      const sr = 48000;
      const r = detectPitchFine(tone(f, sr, 4096), sr)!;
      expect(r, String(f)).toBeDefined();
      expect(Math.abs(1200 * Math.log2(r.freq / f)), String(f)).toBeLessThan(1);
    }
  });

  it('ignores silence and noise', () => {
    expect(detectPitch(new Float32Array(2048), 24000)).toBeUndefined();
    const noise = Float32Array.from({ length: 2048 }, () => (Math.random() * 2 - 1) * 0.3);
    expect(detectPitch(noise, 24000)).toBeUndefined();
  });

  it('names notes and cents, also with another A4', () => {
    expect(readNote(440)).toEqual({ midi: 69, cents: 0 });
    const r = readNote(445);
    expect(r.midi).toBe(69);
    expect(r.cents).toBeCloseTo(19.56, 1);
    expect(readNote(442, 442).cents).toBeCloseTo(0);
    expect(noteName(69, 'solfej')).toBe('La');
    expect(noteName(67, 'harf')).toBe('G');
    expect(octaveOf(69)).toBe(4);
  });

  it('matches the string being tuned', () => {
    const guitar = TUNINGS.find((t) => t.id === 'gitar')!;
    expect(matchString(guitar, 40.2)).toBe(0); // low E
    expect(matchString(guitar, 64)).toBe(5); // high E, not the low one
    const baglama = TUNINGS.find((t) => t.id === 'baglama-bozuk')!;
    expect(matchString(baglama, 57)).toBe(2); // La one octave lower still matches La
    expect(matchString(baglama, 55.1)).toBe(1); // Sol
    expect(median([3, 1, 2, 10, 2])).toBe(2);
  });
});

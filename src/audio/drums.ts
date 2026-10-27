// Sample-free metronome sounds: clicks, beeps and Turkish percussion built
// from noise, oscillators and envelopes (adapted from the Pa5X app).

export type Voice =
  | 'wood' | 'woodHi' | 'beep' | 'beepHi'
  | 'kick' | 'snare' | 'hat'
  | 'darbukaDum' | 'darbukaTek' | 'darbukaKa'
  | 'davulDum' | 'davulTek'
  | 'def' | 'zil';

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

function env(ctx: BaseAudioContext, dest: AudioNode, t: number, peak: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.001 + decay);
  g.connect(dest);
  return g;
}

function tone(ctx: BaseAudioContext, dest: AudioNode, t: number, f0: number, f1: number, drop: number, peak: number, decay: number, type: OscillatorType = 'sine'): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + drop);
  const g = env(ctx, dest, t, peak, decay);
  o.connect(g);
  o.start(t);
  o.stop(t + decay + 0.05);
  o.onended = () => g.disconnect();
}

function hiss(ctx: BaseAudioContext, dest: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number): void {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = env(ctx, dest, t, peak, decay);
  s.connect(f).connect(g);
  s.start(t, Math.random() * 0.5);
  s.stop(t + decay + 0.05);
  s.onended = () => {
    f.disconnect();
    g.disconnect();
  };
}

function metal(ctx: BaseAudioContext, dest: AudioNode, t: number, base: number, peak: number, decay: number): void {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 5000;
  const g = env(ctx, dest, t, peak, decay);
  hp.connect(g);
  let left = 0;
  for (const r of [1, 1.342, 1.2312, 1.6532, 1.9523, 2.1523]) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = base * r;
    o.connect(hp);
    o.start(t);
    o.stop(t + decay + 0.05);
    left++;
    o.onended = () => {
      if (--left === 0) {
        hp.disconnect();
        g.disconnect();
      }
    };
  }
}

/** Woodblock: pitched body, inharmonic partial and a click transient. */
function wood(ctx: BaseAudioContext, dest: AudioNode, t: number, f: number, peak: number): void {
  tone(ctx, dest, t, f * 1.6, f, 0.006, peak, 0.07);
  tone(ctx, dest, t, f * 2.76, f * 2.7, 0.006, peak * 0.35, 0.035, 'triangle');
  tone(ctx, dest, t, f * 4.1, f * 4.1, 0.006, peak * 0.12, 0.006, 'square');
}

function beep(ctx: BaseAudioContext, dest: AudioNode, t: number, f: number, peak: number): void {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
  g.gain.setValueAtTime(peak, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  g.connect(dest);
  o.connect(g);
  o.start(t);
  o.stop(t + 0.12);
  o.onended = () => g.disconnect();
}

/** Schedules one hit at audio time `t`; `vel` 0-1. */
export function playVoice(ctx: BaseAudioContext, dest: AudioNode, voice: Voice, t: number, vel: number): void {
  const v = Math.max(0.05, Math.min(1, vel));
  switch (voice) {
    case 'wood':
      return wood(ctx, dest, t, 1250, 0.75 * v);
    case 'woodHi':
      return wood(ctx, dest, t, 2100, v);
    case 'beep':
      return beep(ctx, dest, t, 880, 0.55 * v);
    case 'beepHi':
      return beep(ctx, dest, t, 1760, 0.7 * v);
    case 'kick':
      return tone(ctx, dest, t, 150, 45, 0.12, v, 0.35);
    case 'snare':
      tone(ctx, dest, t, 240, 160, 0.05, 0.45 * v, 0.12, 'triangle');
      return hiss(ctx, dest, t, 'highpass', 1500, 0.7, 0.7 * v, 0.18);
    case 'hat':
      return metal(ctx, dest, t, 320, 0.22 * v, 0.05);
    case 'darbukaDum':
      return tone(ctx, dest, t, 180, 95, 0.06, 0.95 * v, 0.32);
    case 'darbukaTek':
      tone(ctx, dest, t, 760, 700, 0.02, 0.4 * v, 0.1, 'triangle');
      return hiss(ctx, dest, t, 'bandpass', 4000, 3, 0.4 * v, 0.03);
    case 'darbukaKa':
      tone(ctx, dest, t, 680, 640, 0.02, 0.22 * v, 0.06, 'triangle');
      return hiss(ctx, dest, t, 'bandpass', 3500, 3, 0.25 * v, 0.02);
    case 'davulDum':
      tone(ctx, dest, t, 110, 48, 0.18, v, 0.6);
      return hiss(ctx, dest, t, 'lowpass', 900, 0.7, 0.35 * v, 0.08);
    case 'davulTek':
      hiss(ctx, dest, t, 'bandpass', 2600, 2.5, 0.6 * v, 0.07);
      return tone(ctx, dest, t, 420, 300, 0.03, 0.25 * v, 0.06, 'triangle');
    case 'def':
      tone(ctx, dest, t, 160, 110, 0.08, 0.6 * v, 0.25);
      return metal(ctx, dest, t, 700, 0.06 * v, 0.15);
    case 'zil':
      tone(ctx, dest, t, 2637, 2630, 0.5, 0.12 * v, 0.9);
      return tone(ctx, dest, t, 3951, 3940, 0.5, 0.07 * v, 0.7);
  }
}

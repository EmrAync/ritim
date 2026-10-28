// Metronome engine: lookahead scheduler on AudioContext time (25 ms timer,
// 120 ms horizon). Tempo can follow the rhythm player; "Bir'e dokun"
// restarts the bar at the tap so the clicks line up with the recording.
// Exercise mode changes the tempo bar by bar and can leave bars silent.

import { createStore, persist } from '../lib/store';
import { exerciseBars, exerciseMuted, exerciseTempo } from './exercise';
import { masterOut, unlockAudio } from './context';
import { playVoice, type Voice } from './drums';
import { readLocal, writeLocal } from '../lib/store';
import { player, rhythmClock, type RhythmClock } from './player';
import { mod, nextGridPoint } from './timeline';
import type { Level, MetroSettings, PlanEvent, SoundId, Stroke } from './usuls';
import { DEFAULT_METRO, planBar, sanitizeMetro } from './usuls';

const TIMER_MS = 25;
const LOOKAHEAD_S = 0.12;

export const metroSettings = createStore<MetroSettings>(DEFAULT_METRO);
persist(metroSettings, 'ritim.metro.v1', sanitizeMetro);

export const updateMetro = (patch: Partial<MetroSettings> | ((s: MetroSettings) => MetroSettings)): void =>
  metroSettings.set((s) => (typeof patch === 'function' ? patch(s) : { ...s, ...patch }));

export const metroRunning = createStore(false);

export interface ExerciseRun {
  /** Tempo of the current bar. */
  bpm: number;
  /** Bars completed. */
  bars: number;
  /** Current bar is a silent inner-tempo bar. */
  muted: boolean;
  /** The total time is over (the metronome stopped by itself). */
  finished: boolean;
}

/** Live state of a running exercise (undefined when none runs). */
export const exerciseRun = createStore<ExerciseRun | undefined>(undefined);

// Bar start per rhythm set with "Bir'e dokun" (overrides the analysed one).
const PHASE_KEY = 'ritim.phase.v1';
const phases: Record<string, number> = (() => {
  const raw = readLocal(PHASE_KEY);
  return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
})();

/** Pulses per minute the metronome plays at now. */
export function metroBpm(): number {
  const s = metroSettings.get();
  const run = exerciseRun.get();
  if (s.exercise.on && run && !run.finished) return run.bpm;
  const bpm = s.follow ? player.get().bpm * s.factor : s.bpm;
  return Math.max(20, Math.min(600, bpm));
}

type Hit = [Voice, number];

const LEVEL_VEL: Record<Level, number> = { bar: 1, group: 0.85, beat: 0.7, sub: 0.35 };

function clickVoices(sound: SoundId, ev: PlanEvent, beats: number, grouped: boolean): Hit[] {
  const v = LEVEL_VEL[ev.level];
  const accent = ev.level === 'bar' || ev.level === 'group';
  switch (sound) {
    case 'klasik':
      return [[accent ? 'woodHi' : 'wood', v]];
    case 'mekanik':
      return ev.level === 'bar' ? [['mechBell', 1], ['mechTick', 1]] : [['mechTick', v]];
    case 'bip':
      return [[accent ? 'beepHi' : 'beep', v]];
    case 'darbuka':
      return [[accent ? 'darbukaDum' : ev.level === 'sub' ? 'darbukaKa' : 'darbukaTek', v]];
    case 'davul':
      return [[accent ? 'davulDum' : 'davulTek', v]];
    case 'def':
      return ev.level === 'bar' ? [['def', v], ['zil', 0.7]] : [[ev.level === 'sub' ? 'zil' : 'def', ev.level === 'sub' ? 0.4 : v]];
    case 'bateri': {
      if (ev.level === 'sub') return [['hat', 0.55]];
      const kick = grouped ? accent : ev.beat === 0 || (beats % 2 === 0 && beats >= 4 && ev.beat % 2 === 0);
      return [['hat', ev.level === 'bar' ? 0.9 : 0.75], kick ? ['kick', ev.level === 'bar' ? 1 : 0.85] : ['snare', 0.8]];
    }
  }
}

function strokeVoices(sound: SoundId, stroke: Stroke, bar: boolean): Hit[] {
  const v = stroke === 'K' ? 0.55 : bar ? 1 : 0.85;
  switch (sound) {
    case 'klasik':
      return [[stroke === 'D' ? 'woodHi' : 'wood', v]];
    case 'mekanik':
      return bar ? [['mechBell', 1], ['mechTick', 1]] : [['mechTick', v]];
    case 'bip':
      return [[stroke === 'D' ? 'beepHi' : 'beep', v]];
    case 'davul':
      return [[stroke === 'D' ? 'davulDum' : 'davulTek', v]];
    case 'def':
      return stroke === 'D' ? [['def', v]] : [['def', v * 0.6], ['zil', 0.4]];
    case 'bateri':
      return stroke === 'D' ? [['kick', v], ['hat', 0.7]] : stroke === 'T' ? [['snare', v], ['hat', 0.6]] : [['hat', 0.5]];
    case 'darbuka':
      return [[stroke === 'D' ? 'darbukaDum' : stroke === 'T' ? 'darbukaTek' : 'darbukaKa', v]];
  }
}

export interface Visual {
  time: number;
  beat: number;
  level: Level;
  /** Running count of pulses (the classic pendulum swings to the other side on each). */
  n: number;
  /** Silent exercise bar. */
  muted: boolean;
}

class Metronome {
  private ctx?: AudioContext;
  private out?: GainNode;
  private seg?: GainNode;
  private timer?: ReturnType<typeof setInterval>;
  private plan: PlanEvent[] = [];
  private beats = 4;
  private idx = 0;
  private nextTime = 0;
  private visuals: Visual[] = [];
  private locked = false;
  private lockedUntil = 0;
  private count = 0;
  private exStart = 0;

  constructor() {
    metroSettings.subscribe(() => {
      if (this.out) this.out.gain.value = metroSettings.get().volume;
    });
  }

  start(): void {
    if (metroRunning.get()) return;
    const ctx = unlockAudio();
    this.ctx = ctx;
    if (!this.out) {
      this.out = ctx.createGain();
      // Limiter: accents (bell + tick, kick + hat) never clip on phone speakers.
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -4;
      limit.knee.value = 2;
      limit.ratio.value = 12;
      limit.attack.value = 0.001;
      limit.release.value = 0.08;
      this.out.connect(limit).connect(masterOut());
    }
    this.out.gain.value = metroSettings.get().volume;
    metroRunning.set(true);
    this.restartBar(0.06);
    const ex = metroSettings.get().exercise;
    this.exStart = this.nextTime;
    exerciseRun.set(ex.on ? { bpm: exerciseTempo(ex, 0, 0), bars: 0, muted: exerciseMuted(ex, 0), finished: false } : undefined);
    this.timer = setInterval(() => this.schedule(), TIMER_MS);
    this.schedule();
  }

  stop(finished = false): void {
    if (!finished && !exerciseRun.get()?.finished) exerciseRun.set(undefined);
    clearInterval(this.timer);
    this.timer = undefined;
    this.seg?.disconnect();
    this.seg = undefined;
    this.visuals = [];
    metroRunning.set(false);
  }

  toggle(): void {
    if (metroRunning.get()) this.stop();
    else this.start();
  }

  /**
   * "Bir'e dokun": the bar starts now. Locked to a rhythm, the spot is saved
   * for that rhythm so its clicks stay on its downbeat from then on.
   */
  tapOne(): void {
    if (!metroRunning.get()) {
      this.start();
      return;
    }
    const clock = this.lockClock();
    if (clock && this.ctx) {
      const id = player.get().rhythmId;
      if (id) {
        phases[id] = Math.round(clock.posAt(this.ctx.currentTime) * 1000) / 1000;
        writeLocal(PHASE_KEY, phases);
      }
      this.resetSeg();
      this.lockedUntil = this.ctx.currentTime;
      this.schedule();
      return;
    }
    this.restartBar(0.005);
    this.schedule();
  }

  /** Clock of the rhythm the metronome follows, when it is playing. */
  private lockClock(): RhythmClock | undefined {
    const s = metroSettings.get();
    // An exercise sets its own tempo.
    return s.follow && !s.exercise.on ? rhythmClock() : undefined;
  }

  /** Seconds since the exercise started. */
  exerciseSeconds(): number {
    return this.ctx && metroRunning.get() ? Math.max(0, this.ctx.currentTime - this.exStart) : 0;
  }

  /** Bar line in exercise mode: next tempo and silence, or the end. */
  private barDone(): void {
    const ex = metroSettings.get().exercise;
    const run = exerciseRun.get();
    if (!ex.on || !run || run.finished) return;
    const bars = run.bars + 1;
    const sec = this.nextTime - this.exStart;
    const bounded = ex.finish === 'hedef' ? exerciseBars(ex) : undefined;
    const over =
      ex.finish === 'sure'
        ? sec >= ex.totalMin * 60
        : ex.finish === 'hedef' && (bounded !== undefined ? bars >= bounded : ex.kind === 'sure' && sec >= ex.rampMin * 60);
    if (over) {
      exerciseRun.set({ ...run, bars, finished: true });
      const at = this.nextTime;
      this.nextTime = Infinity;
      setTimeout(() => this.stop(true), Math.max(0, (at - this.ctx!.currentTime) * 1000));
      return;
    }
    exerciseRun.set({ bpm: exerciseTempo(ex, bars, sec), bars, muted: exerciseMuted(ex, bars), finished: false });
  }

  /** Audio clock (for animations synced to the clicks). */
  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** The pulse sounding now (for the beat lights). */
  current(): Visual | undefined {
    const t = this.ctx?.currentTime ?? 0;
    let cur: Visual | undefined;
    for (const v of this.visuals) {
      if (v.time <= t) cur = v;
      else break;
    }
    return cur;
  }

  private resetSeg(): void {
    this.seg?.disconnect();
    this.seg = this.ctx!.createGain();
    this.seg.connect(this.out!);
    this.visuals = [];
  }

  private restartBar(delay: number): void {
    const ctx = this.ctx!;
    this.resetSeg();
    this.newBar();
    this.nextTime = ctx.currentTime + delay;
  }

  private newBar(): void {
    const s = metroSettings.get();
    this.plan = planBar(s);
    this.beats = s.beats;
    this.idx = 0;
  }

  private play(ev: PlanEvent, t: number): void {
    const s = metroSettings.get();
    const muted = !this.locked && s.exercise.on && exerciseRun.get()?.muted === true;
    if (!ev.silent && !muted) {
      const grouped = s.grouping.some((g) => g > 1);
      const hits = ev.stroke ? strokeVoices(s.sound, ev.stroke, ev.at === 0) : clickVoices(s.sound, ev, s.beats, grouped);
      for (const [voice, vel] of hits) playVoice(this.ctx!, this.seg!, voice, t, vel);
    }
    if (ev.level !== 'sub') this.visuals.push({ time: t, beat: ev.beat, level: ev.level, n: this.count++, muted });
  }

  /** Clicks on the rhythm's own beat grid, at the positions the recording is heard. */
  private scheduleLocked(c: RhythmClock): void {
    const ctx = this.ctx!;
    const s = metroSettings.get();
    const plan = planBar(s);
    const sub = plan.some((e) => e.stroke) ? 1 : s.subdivision;
    const byPos = new Map(plan.map((e) => [`${e.beat}:${Math.round((e.at - e.beat) * sub)}`, e]));
    const step = 60 / (c.bpm * s.factor) / sub;
    const id = player.get().rhythmId;
    const phase = (id ? phases[id] : undefined) ?? c.phase;
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    let t = Math.max(this.lockedUntil, ctx.currentTime);
    for (let guard = 0; guard < 64; guard++) {
      const hit = nextGridPoint(c.posAt(t), c.loopLen, phase, step);
      const te = t + hit.dist / Math.max(0.1, c.rateAt(t));
      // A tempo change before the hit: continue from there with the new tempo.
      const change = c.nextChange(t);
      if (change !== undefined && change < te && change <= horizon) {
        t = change;
        continue;
      }
      if (te > horizon) break;
      const pulse = Math.floor(hit.k / sub);
      const ev = byPos.get(`${mod(pulse, s.beats)}:${mod(hit.k, sub)}`);
      if (ev) this.play(ev, te);
      t = te + 1e-4;
      this.lockedUntil = t;
    }
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.seg) return;
    const clock = this.lockClock();
    if (clock) {
      if (!this.locked) {
        this.locked = true;
        this.resetSeg();
        this.lockedUntil = ctx.currentTime;
      }
      this.scheduleLocked(clock);
      this.trimVisuals();
      return;
    }
    if (this.locked) {
      this.locked = false;
      this.restartBar(0.05);
    }
    // Back from the background (timers were throttled): skip the missed clicks
    // instead of scheduling them all at once, which can freeze a phone.
    if (this.nextTime < ctx.currentTime - 0.25) {
      this.nextTime = ctx.currentTime + 0.05;
      this.visuals = [];
    }
    for (let guard = 0; guard < 128 && this.nextTime < ctx.currentTime + LOOKAHEAD_S; guard++) {
      const ev = this.plan[this.idx];
      this.play(ev, Math.max(this.nextTime, ctx.currentTime));
      const nextAt = this.idx + 1 < this.plan.length ? this.plan[this.idx + 1].at : this.beats;
      this.nextTime += ((nextAt - ev.at) * 60) / metroBpm();
      this.idx++;
      // Settings changes (meter, accents, usul) take effect at the bar line.
      if (this.idx >= this.plan.length) {
        this.barDone();
        this.newBar();
      }
    }
    this.trimVisuals();
  }

  private trimVisuals(): void {
    const old = this.ctx!.currentTime - 1;
    while (this.visuals.length > 1 && this.visuals[0].time < old) this.visuals.shift();
  }
}

export const metronome = new Metronome();

// START/STOP of the rhythm also drives the metronome when linked.
let wasPlaying = player.get().playing;
player.subscribe(() => {
  const p = player.get().playing;
  if (p === wasPlaying) return;
  wasPlaying = p;
  if (!metroSettings.get().withRhythm) return;
  if (p) {
    metronome.stop();
    metronome.start();
  } else metronome.stop();
});

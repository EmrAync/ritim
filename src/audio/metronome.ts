// Metronome engine: lookahead scheduler on AudioContext time (25 ms timer,
// 120 ms horizon). Tempo can follow the rhythm player; "Bir'e dokun"
// restarts the bar at the tap so the clicks line up with the recording.

import { createStore, persist } from '../lib/store';
import { masterOut, unlockAudio } from './context';
import { playVoice, type Voice } from './drums';
import { player } from './player';
import type { Level, MetroSettings, PlanEvent, SoundId, Stroke } from './usuls';
import { DEFAULT_METRO, planBar, sanitizeMetro } from './usuls';

const TIMER_MS = 25;
const LOOKAHEAD_S = 0.12;

export const metroSettings = createStore<MetroSettings>(DEFAULT_METRO);
persist(metroSettings, 'ritim.metro.v1', sanitizeMetro);

export const updateMetro = (patch: Partial<MetroSettings> | ((s: MetroSettings) => MetroSettings)): void =>
  metroSettings.set((s) => (typeof patch === 'function' ? patch(s) : { ...s, ...patch }));

export const metroRunning = createStore(false);

/** Pulses per minute the metronome plays at now. */
export function metroBpm(): number {
  const s = metroSettings.get();
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
      this.out.connect(masterOut());
    }
    this.out.gain.value = metroSettings.get().volume;
    metroRunning.set(true);
    this.restartBar(0.06);
    this.timer = setInterval(() => this.schedule(), TIMER_MS);
    this.schedule();
  }

  stop(): void {
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

  /** Starts a new bar right now ("Bir'e dokun"), dropping clicks already scheduled. */
  tapOne(): void {
    if (!metroRunning.get()) {
      this.start();
      return;
    }
    this.restartBar(0.005);
    this.schedule();
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

  private restartBar(delay: number): void {
    const ctx = this.ctx!;
    this.seg?.disconnect();
    this.seg = ctx.createGain();
    this.seg.connect(this.out!);
    this.visuals = [];
    this.newBar();
    this.nextTime = ctx.currentTime + delay;
  }

  private newBar(): void {
    const s = metroSettings.get();
    this.plan = planBar(s);
    this.beats = s.beats;
    this.idx = 0;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.seg) return;
    const s = metroSettings.get();
    const grouped = s.grouping.some((g) => g > 1);
    while (this.nextTime < ctx.currentTime + LOOKAHEAD_S) {
      const ev = this.plan[this.idx];
      const t = Math.max(this.nextTime, ctx.currentTime);
      if (!ev.silent) {
        const hits = ev.stroke ? strokeVoices(s.sound, ev.stroke, ev.at === 0) : clickVoices(s.sound, ev, this.beats, grouped);
        for (const [voice, vel] of hits) playVoice(ctx, this.seg, voice, t, vel);
      }
      if (ev.level !== 'sub') this.visuals.push({ time: t, beat: ev.beat, level: ev.level });
      const nextAt = this.idx + 1 < this.plan.length ? this.plan[this.idx + 1].at : this.beats;
      this.nextTime += ((nextAt - ev.at) * 60) / metroBpm();
      this.idx++;
      // Settings changes (meter, accents, usul) take effect at the bar line.
      if (this.idx >= this.plan.length) this.newBar();
    }
    const old = ctx.currentTime - 1;
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

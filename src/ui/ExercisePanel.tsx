// Exercise mode settings and live status: start/target tempo, how it
// changes, total time, inner-tempo silent bars, ready-made programs.

import { useEffect, useState } from 'react';
import { EXERCISE_KINDS, EXERCISE_PRESETS, type ExerciseSettings } from '../audio/exercise';
import { exerciseRun, metronome, metroRunning, metroSettings, updateMetro } from '../audio/metronome';
import { formatTime } from '../data/rhythms';
import { useStore } from '../lib/store';
import { Icon } from './icons';

const TOTALS = [0, 5, 10, 15, 20, 30, 45, 60];

function Stepper({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange(v: number): void }) {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-row">
        <button className="round-btn small" onClick={() => set(value - step)} aria-label={`${label} azalt`}>
          <Icon name="minus" size={18} />
        </button>
        <b>
          {value}
          {unit ? <small> {unit}</small> : null}
        </b>
        <button className="round-btn small" onClick={() => set(value + step)} aria-label={`${label} artır`}>
          <Icon name="plus" size={18} />
        </button>
      </div>
    </div>
  );
}

/** Live line above the metronome while an exercise runs. */
export function ExerciseStatus() {
  const s = useStore(metroSettings);
  const run = useStore(exerciseRun);
  const running = useStore(metroRunning);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [running]);
  if (!s.exercise.on) return null;
  const ex = s.exercise;
  if (run?.finished) return <div className="ex-status done">Egzersiz tamamlandı · {run.bars} ölçü</div>;
  if (!run || !running) {
    return (
      <div className="ex-status">
        Egzersiz hazır: {ex.start} → {ex.target} BPM · START'a basın
      </div>
    );
  }
  const sec = metronome.exerciseSeconds();
  const left = ex.totalMin ? Math.max(0, ex.totalMin * 60 - sec) : undefined;
  return (
    <div className={run.muted ? 'ex-status muted' : 'ex-status'}>
      <b>{run.bpm} BPM</b> → {ex.target} · ölçü {run.bars + 1} · {left !== undefined ? `kalan ${formatTime(left)}` : formatTime(sec)}
      {run.muted ? ' · sessiz ölçü: tempoyu içinizden sayın' : ''}
    </div>
  );
}

export function ExercisePanel() {
  const ex = useStore(metroSettings).exercise;
  const set = (patch: Partial<ExerciseSettings>) => updateMetro((x) => ({ ...x, exercise: { ...x.exercise, ...patch } }));
  const kind = EXERCISE_KINDS.find((k) => k.id === ex.kind)!;
  return (
    <section className="card">
      <h3>Egzersiz modu</h3>
      <button className={ex.on ? 'toggle on' : 'toggle'} onClick={() => set({ on: !ex.on })} role="switch" aria-checked={ex.on}>
        <span className="toggle-knob" />
        <span>Tempo kendiliğinden hızlansın / yavaşlasın</span>
      </button>
      {ex.on && (
        <>
          <div className="chips-scroll">
            {EXERCISE_PRESETS.map((p) => (
              <button key={p.label} className="chip" onClick={() => set(p.set)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="chip-grid">
            {EXERCISE_KINDS.map((k) => (
              <button key={k.id} className={ex.kind === k.id ? 'chip on' : 'chip'} onClick={() => set({ kind: k.id })}>
                {k.label}
              </button>
            ))}
          </div>
          <p className="hint">{kind.hint} Hedef başlangıçtan düşükse tempo yavaşlar.</p>
          <div className="stepper-grid">
            <Stepper label="Başlangıç" value={ex.start} min={30} max={300} unit="BPM" onChange={(v) => set({ start: v })} />
            <Stepper label="Hedef" value={ex.target} min={30} max={300} unit="BPM" onChange={(v) => set({ target: v })} />
            {(ex.kind === 'adim' || ex.kind === 'piramit') && <Stepper label="Her adımda" value={ex.step} min={1} max={40} unit="BPM" onChange={(v) => set({ step: v })} />}
            {ex.kind !== 'sure' && <Stepper label="Kaç ölçüde bir" value={ex.everyBars} min={1} max={64} unit="ölçü" onChange={(v) => set({ everyBars: v })} />}
            {ex.kind === 'sure' && <Stepper label="Hedefe varış" value={ex.rampMin} min={1} max={120} unit="dk" onChange={(v) => set({ rampMin: v })} />}
          </div>
          <span className="label">Toplam süre (dolunca durur)</span>
          <div className="chip-grid">
            {TOTALS.map((m) => (
              <button key={m} className={ex.totalMin === m ? 'chip on' : 'chip'} onClick={() => set({ totalMin: m })}>
                {m ? `${m} dk` : 'Sınırsız'}
              </button>
            ))}
          </div>
          <button className={ex.gap ? 'toggle on' : 'toggle'} onClick={() => set({ gap: !ex.gap })} role="switch" aria-checked={ex.gap}>
            <span className="toggle-knob" />
            <span>
              İç tempo çalışması <small>(birkaç ölçü çalar, birkaç ölçü susar)</small>
            </span>
          </button>
          {ex.gap && (
            <div className="stepper-grid">
              <Stepper label="Çal" value={ex.playBars} min={1} max={32} unit="ölçü" onChange={(v) => set({ playBars: v })} />
              <Stepper label="Sus" value={ex.muteBars} min={1} max={32} unit="ölçü" onChange={(v) => set({ muteBars: v })} />
            </div>
          )}
          <p className="hint">Egzersiz açıkken metronom kendi temposunu kullanır (ritme bağlı değildir).</p>
        </>
      )}
    </section>
  );
}

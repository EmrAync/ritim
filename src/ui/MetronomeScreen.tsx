// Metronome: beat lights (tap to change accent), tempo knob, usuls and
// aksak meters, sounds, and the link to the rhythm player.

import { useEffect, useRef, useState } from 'react';
import { metronome, metroRunning, metroSettings, updateMetro } from '../audio/metronome';
import { currentRhythm, player, setBpm as setRhythmBpm } from '../audio/player';
import { TapTempo, tempoRange } from '../audio/tempo';
import {
  cycleMark, groupingOptions, isGrouped, meterForRhythm, meterLabel, USULS, UNITS, withMeter, withUsul, type SoundId, type Subdivision,
} from '../audio/usuls';
import { useStore } from '../lib/store';
import { Header } from './common';
import { Icon } from './icons';
import { Knob } from './Knob';

const SOUNDS: { id: SoundId; label: string }[] = [
  { id: 'klasik', label: 'Tahta tık' },
  { id: 'bip', label: 'Bip' },
  { id: 'darbuka', label: 'Darbuka' },
  { id: 'davul', label: 'Davul' },
  { id: 'def', label: 'Def + zil' },
  { id: 'bateri', label: 'Bateri' },
];

function BeatLights() {
  const s = useStore(metroSettings);
  const running = useStore(metroRunning);
  const [cur, setCur] = useState(-1);
  useEffect(() => {
    if (!running) {
      setCur(-1);
      return;
    }
    let raf = 0;
    const loop = () => {
      setCur(metronome.current()?.beat ?? -1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  const groups: number[][] = [];
  let i = 0;
  for (const g of s.grouping.some((x) => x > 1) ? s.grouping : [s.beats]) {
    groups.push(Array.from({ length: g }, () => i++));
  }
  return (
    <div className={s.beats >= 8 ? "beats many" : "beats"}>
      {groups.map((g, gi) => (
        <div key={gi} className="beat-group">
          {g.map((b) => (
            <button
              key={b}
              className={`beat ${s.marks[b]} ${b === cur ? 'now' : ''}`}
              onClick={() => updateMetro((x) => ({ ...x, marks: x.marks.map((m, k) => (k === b ? cycleMark(m) : m)) }))}
              aria-label={`Vuruş ${b + 1}`}
            >
              {b + 1}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, children }: { on: boolean; onChange(v: boolean): void; children: React.ReactNode }) {
  return (
    <button className={on ? 'toggle on' : 'toggle'} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="toggle-knob" />
      <span>{children}</span>
    </button>
  );
}

export function MetronomeScreen() {
  const s = useStore(metroSettings);
  const running = useStore(metroRunning);
  const pl = useStore(player);
  const tap = useRef(new TapTempo());
  const r = currentRhythm();
  const bpm = Math.round(s.follow ? pl.bpm * s.factor : s.bpm);
  const [lo, hi] = s.follow ? tempoRange(r?.bpm).map((x) => Math.round(x * s.factor)) : [30, 300];

  const setBpm = (v: number) => {
    if (s.follow) setRhythmBpm(v / s.factor);
    else updateMetro({ bpm: Math.max(30, Math.min(300, Math.round(v))) });
  };
  const usul = USULS.find((u) => u.id === s.usulId);
  const options = groupingOptions(s.beats);

  return (
    <div className="screen">
      <Header title="Metronom" />
      <div className="scroll metro">
        <BeatLights />
        <p className="hint center">
          {usul ? `${usul.name} · ` : ''}
          {meterLabel(s.beats, s.unit, s.grouping)} · vuruşa dokun: vurgulu / normal / sessiz
        </p>

        <div className="tempo">
          <Knob value={bpm} min={lo} max={hi} onChange={setBpm} caption={s.follow ? 'BPM · ritimle' : 'BPM'} label="Metronom temposu" />
          <div className="tempo-row">
            <button className="round-btn" onClick={() => setBpm(bpm - 1)} aria-label="Tempo azalt">
              <Icon name="minus" size={28} />
            </button>
            <button
              className="tap-btn"
              onPointerDown={() => {
                const v = tap.current.tap(performance.now());
                if (v) setBpm(v);
              }}
            >
              TAP
            </button>
            <button className="round-btn" onClick={() => setBpm(bpm + 1)} aria-label="Tempo artır">
              <Icon name="plus" size={28} />
            </button>
          </div>
        </div>

        <div className="metro-actions">
          <button className={running ? 'start-btn on' : 'start-btn'} onClick={() => metronome.toggle()}>
            {running ? (
              <>
                <Icon name="stop" size={28} /> STOP
              </>
            ) : (
              <>
                <Icon name="play" size={28} /> START
              </>
            )}
          </button>
          <button className="one-btn" onPointerDown={() => metronome.tapOne()}>
            Bir'e
            <br />
            dokun
          </button>
        </div>

        <section className="card">
          <h3>Ritimle birlikte</h3>
          <Toggle on={s.follow} onChange={(v) => updateMetro((x) => ({ ...x, follow: v, factor: v && r?.meter?.endsWith('/8') ? 2 : x.factor }))}>
            Tempoyu ritme bağla {r ? <small>({r.title})</small> : null}
          </Toggle>
          {s.follow && (
            <div className="chips-row">
              <span className="muted">Tık hızı</span>
              {([0.5, 1, 2] as const).map((f) => (
                <button key={f} className={s.factor === f ? 'chip on' : 'chip'} onClick={() => updateMetro({ factor: f })}>
                  {f === 0.5 ? '×½' : f === 1 ? '×1' : '×2'}
                </button>
              ))}
            </div>
          )}
          <Toggle on={s.withRhythm} onChange={(v) => updateMetro({ withRhythm: v })}>
            Ritmin START/STOP'u metronomu da başlatsın
          </Toggle>
          {r?.meter && (
            <button className="ghost-btn" onClick={() => updateMetro((x) => meterForRhythm(x, r.meter))}>
              Ritmin ölçüsünü kullan ({r.meter})
            </button>
          )}
          <p className="hint">Tıklar ritmin vuruşuna oturmazsa ritim çalarken ölçünün 1. vuruşunda “Bir'e dokun”a basın.</p>
        </section>

        <section className="card">
          <h3>Usul</h3>
          <div className="chip-grid">
            <button className={!s.usulId ? 'chip on' : 'chip'} onClick={() => updateMetro((x) => withMeter(x, x.beats, x.unit, x.grouping))}>
              Serbest
            </button>
            {USULS.map((u) => (
              <button key={u.id} className={s.usulId === u.id ? 'chip on' : 'chip'} onClick={() => updateMetro((x) => withUsul(x, u))}>
                {u.name} <small>{u.beats}/{u.unit}</small>
              </button>
            ))}
          </div>
          {usul && (
            <Toggle on={s.strokes} onChange={(v) => updateMetro({ strokes: v })}>
              Düm-tek vuruşlarını çal <small>({usul.pattern.replace(/-/g, '·').split('').join(' ')})</small>
            </Toggle>
          )}
        </section>

        <section className="card">
          <h3>Ölçü</h3>
          <div className="chips-row">
            <button className="round-btn small" onClick={() => updateMetro((x) => withMeter(x, x.beats - 1, x.unit))} aria-label="Vuruş azalt">
              <Icon name="minus" size={20} />
            </button>
            <b className="meter-num">{s.beats}</b>
            <button className="round-btn small" onClick={() => updateMetro((x) => withMeter(x, x.beats + 1, x.unit))} aria-label="Vuruş artır">
              <Icon name="plus" size={20} />
            </button>
            <span className="muted">/</span>
            {UNITS.map((u) => (
              <button key={u} className={s.unit === u ? 'chip on' : 'chip'} onClick={() => updateMetro((x) => withMeter(x, x.beats, u, x.grouping, x.usulId && x.unit === u ? x.usulId : ''))}>
                {u}
              </button>
            ))}
          </div>
          {options.length > 0 && (
            <div className="chip-grid">
              <button className={!isGrouped(s.grouping) ? 'chip on' : 'chip'} onClick={() => updateMetro((x) => withMeter(x, x.beats, x.unit))}>
                Düz
              </button>
              {options.map((g) => (
                <button key={g.join()} className={s.grouping.join() === g.join() ? 'chip on' : 'chip'} onClick={() => updateMetro((x) => withMeter(x, x.beats, x.unit, g))}>
                  {g.join('+')}
                </button>
              ))}
            </div>
          )}
          {!s.strokes && (
            <div className="chips-row">
              <span className="muted">Ara vuruş</span>
              {([1, 2, 3, 4] as Subdivision[]).map((d) => (
                <button key={d} className={s.subdivision === d ? 'chip on' : 'chip'} onClick={() => updateMetro({ subdivision: d })}>
                  {d === 1 ? 'Yok' : d === 3 ? 'Üçleme' : `×${d}`}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h3>Ses</h3>
          <div className="chip-grid">
            {SOUNDS.map((x) => (
              <button key={x.id} className={s.sound === x.id ? 'chip on' : 'chip'} onClick={() => updateMetro({ sound: x.id })}>
                {x.label}
              </button>
            ))}
          </div>
          <label className="slider">
            <span>Metronom sesi</span>
            <input type="range" min={0} max={1} step={0.01} value={s.volume} onChange={(e) => updateMetro({ volume: Number(e.target.value) })} />
          </label>
        </section>
      </div>
    </div>
  );
}

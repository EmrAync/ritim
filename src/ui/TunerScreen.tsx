// Tuner: big note name, cents needle (green when in tune), frequency and
// koma, instrument tunings with reference tones, A4 calibration.

import { useEffect, useState } from 'react';
import { metronome, metroRunning } from '../audio/metronome';
import { INSTRUMENTS, KOMA_CENTS, TUNINGS, noteName, octaveOf } from '../audio/pitch';
import { player, stopRhythm } from '../audio/player';
import { SHIFTS, currentTuning, playReference, startTuner, stopTuner, tuner, tunerSettings } from '../audio/tuner';
import { useStore } from '../lib/store';
import { Header } from './common';
import { Icon } from './icons';

const IN_TUNE = 5;
const STALE_MS = 1500;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [150 + r * Math.cos(a), 150 + r * Math.sin(a)];
}

function arc(r: number, from: number, to: number): string {
  const [x0, y0] = polar(r, from);
  const [x1, y1] = polar(r, to);
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
}

/** ±50 cents over ±60°. */
const deg = (cents: number) => Math.max(-50, Math.min(50, cents)) * 1.2;

function Gauge({ cents, active }: { cents: number; active: boolean }) {
  const ok = active && Math.abs(cents) <= IN_TUNE;
  const ticks = [];
  for (let c = -50; c <= 50; c += 5) {
    const [x0, y0] = polar(118, deg(c));
    const [x1, y1] = polar(c % 25 === 0 ? 100 : c % 10 === 0 ? 106 : 110, deg(c));
    ticks.push(<line key={c} x1={x0} y1={y0} x2={x1} y2={y1} className={c === 0 ? 'tg-tick zero' : 'tg-tick'} />);
  }
  return (
    <svg className="tuner-gauge" viewBox="0 20 300 150" aria-hidden="true">
      <path d={arc(124, deg(-50), deg(50))} className="tg-track" />
      <path d={arc(124, deg(-IN_TUNE), deg(IN_TUNE))} className="tg-zone" />
      {ticks}
      {[-50, -25, 0, 25, 50].map((c) => {
        const [x, y] = polar(86, deg(c));
        return (
          <text key={c} x={x} y={y + 4} className="tg-label">
            {c > 0 ? `+${c}` : c}
          </text>
        );
      })}
      <g className={ok ? 'tg-needle ok' : active ? 'tg-needle' : 'tg-needle idle'} style={{ transform: `rotate(${active ? deg(cents) : 0}deg)` }}>
        <line x1="150" y1="150" x2="150" y2="30" />
        <circle cx="150" cy="150" r="7" />
      </g>
    </svg>
  );
}

export function TunerScreen() {
  const st = useStore(tuner);
  const s = useStore(tunerSettings);
  const pl = useStore(player);
  const metroOn = useStore(metroRunning);
  const [, tick] = useState(0);
  const t = currentTuning(s);

  useEffect(() => {
    // Show the chosen tuning in the chip row.
    document.querySelector('.tuner .chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    return () => stopTuner();
  }, []);
  useEffect(() => {
    if (!st.listening) return;
    const id = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(id);
  }, [st.listening]);

  const r = st.reading;
  const fresh = !!r && performance.now() - r.at < STALE_MS;
  const cents = fresh ? r!.cents : 0;
  const ok = fresh && Math.abs(cents) <= IN_TUNE;
  const status = !fresh ? (st.listening ? 'Bir tel çalın' : 'Dinlemek için başlatın') : ok ? 'Tamam' : cents < 0 ? 'Pes — sıkın' : 'Tiz — gevşetin';
  const setS = (p: Partial<typeof s>) => tunerSettings.set((x) => ({ ...x, ...p }));
  const label = (midi: number) => `${noteName(midi, s.naming)}${t.anyOctave ? '' : octaveOf(midi)}`;

  return (
    <div className="screen">
      <Header title="Akort (Tuner)" />
      <div className="scroll tuner">
        <div className="segmented wide" role="tablist">
          {INSTRUMENTS.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={t.instrument === x.id}
              className={t.instrument === x.id ? 'on' : ''}
              onClick={() => setS({ tuningId: TUNINGS.find((y) => y.instrument === x.id)!.id })}
            >
              {x.label}
            </button>
          ))}
        </div>
        {(t.instrument === 'baglama' || t.instrument === 'gitar') && (
          <div className="chips-scroll">
            {TUNINGS.filter((x) => x.instrument === t.instrument).map((x) => (
              <button key={x.id} className={s.tuningId === x.id ? 'chip on' : 'chip'} onClick={() => setS({ tuningId: x.id })}>
                {x.name}
              </button>
            ))}
          </div>
        )}
        {t.instrument === 'baglama' && (
          <div className="chips-row tuner-level">
            <span className="muted">Ses seviyesi (alt tel)</span>
            {SHIFTS.map((sh) => (
              <button key={sh} className={s.shift === sh ? 'chip on' : 'chip'} onClick={() => setS({ shift: sh })}>
                {noteName(57 + sh, s.naming)}
              </button>
            ))}
          </div>
        )}
        {t.note && <p className="hint center">{t.note}</p>}

        <div className={ok ? 'tuner-display ok' : 'tuner-display'}>
          <div className="tuner-note">
            {fresh ? noteName(r!.midi, s.naming) : '—'}
            {fresh && <sub>{octaveOf(r!.midi)}</sub>}
          </div>
          <Gauge cents={cents} active={fresh} />
          <div className="tuner-status">
            {fresh && !ok && <Icon name={cents < 0 ? 'up' : 'down'} size={20} />}
            {ok && <Icon name="check" size={20} />}
            <span>{status}</span>
          </div>
          <div className="tuner-meta">
            <span>{fresh ? `${cents > 0 ? '+' : ''}${cents.toFixed(1)} sent` : ' '}</span>
            <span>{fresh ? `${r!.freq.toFixed(1)} Hz` : ' '}</span>
            <span>{fresh ? `${cents >= 0 ? '+' : ''}${(cents / KOMA_CENTS).toFixed(1)} koma` : ' '}</span>
          </div>
        </div>

        {t.strings.length > 0 && (
          <div className="tuner-strings">
            {t.strings.map((m, i) => (
              <button key={i} className={fresh && r!.string === i ? (ok ? 'tstring ok' : 'tstring on') : 'tstring'} onClick={() => playReference(m)} aria-label={`${label(m)} referans sesi`}>
                <b>{label(m)}</b>
                <small>{t.labels?.[i] ?? `${i + 1}. tel`}</small>
              </button>
            ))}
          </div>
        )}
        {t.strings.length > 0 && <p className="hint center">Bir tele dokunursanız referans sesini çalar.</p>}

        {s.tuningId === 'ozel' && (
          <section className="card">
            <h3>Kendi düzenim</h3>
            {s.custom.map((m, i) => (
              <div key={i} className="chips-row">
                <span className="muted">{i + 1}. tel</span>
                <button className="round-btn small" onClick={() => setS({ custom: s.custom.map((x, k) => (k === i ? Math.max(24, x - 1) : x)) })} aria-label="Yarım ses pes">
                  <Icon name="minus" size={18} />
                </button>
                <b className="meter-num">{noteName(m, s.naming)}</b>
                <button className="round-btn small" onClick={() => setS({ custom: s.custom.map((x, k) => (k === i ? Math.min(96, x + 1) : x)) })} aria-label="Yarım ses tiz">
                  <Icon name="plus" size={18} />
                </button>
              </div>
            ))}
            <div className="chips-row">
              {s.custom.length < 8 && (
                <button className="chip" onClick={() => setS({ custom: [...s.custom, s.custom[s.custom.length - 1] ?? 69] })}>
                  + Tel ekle
                </button>
              )}
              {s.custom.length > 1 && (
                <button className="chip" onClick={() => setS({ custom: s.custom.slice(0, -1) })}>
                  − Son teli çıkar
                </button>
              )}
            </div>
          </section>
        )}

        {(pl.playing || metroOn) && (
          <div className="error">
            Ritim veya metronom çalıyor; mikrofon onu da duyar.{' '}
            <button
              className="link-btn"
              onClick={() => {
                stopRhythm();
                metronome.stop();
              }}
            >
              Durdur
            </button>
          </div>
        )}
        {st.error && <div className="error">{st.error}</div>}

        <button className={st.listening ? 'start-btn on' : 'start-btn'} onClick={() => (st.listening ? stopTuner() : void startTuner())} disabled={st.starting}>
          <Icon name={st.listening ? 'stop' : 'tuner'} size={28} />
          {st.starting ? 'Mikrofon açılıyor…' : st.listening ? 'DURDUR' : 'DİNLE'}
        </button>

        <section className="card">
          <h3>Ayarlar</h3>
          <div className="chips-row">
            <span className="muted">La (A4) =</span>
            <button className="round-btn small" onClick={() => setS({ a4: Math.max(415, s.a4 - 1) })} aria-label="Referans düşür">
              <Icon name="minus" size={18} />
            </button>
            <b className="meter-num">{s.a4}</b>
            <button className="round-btn small" onClick={() => setS({ a4: Math.min(466, s.a4 + 1) })} aria-label="Referans yükselt">
              <Icon name="plus" size={18} />
            </button>
            <span className="muted">Hz</span>
            {s.a4 !== 440 && (
              <button className="chip" onClick={() => setS({ a4: 440 })}>
                440
              </button>
            )}
          </div>
          <div className="chips-row">
            <span className="muted">Nota adları</span>
            <button className={s.naming === 'solfej' ? 'chip on' : 'chip'} onClick={() => setS({ naming: 'solfej' })}>
              Do Re Mi
            </button>
            <button className={s.naming === 'harf' ? 'chip on' : 'chip'} onClick={() => setS({ naming: 'harf' })}>
              C D E
            </button>
          </div>
          <p className="hint">
            Telefonu enstrümana yakın tutun ve teli tek tek çalın. Yeşil yanınca tel akortludur. Koma, Türk müziğindeki 1/9 tam ses aralığıdır (≈22,6 sent).
          </p>
        </section>
      </div>
    </div>
  );
}

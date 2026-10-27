// Main screen: current rhythm, rotary tempo knob with −/+/TAP, loop
// progress, START/STOP and the stop timer. Everything else is in the ⋮ menu.

import { useEffect, useRef, useState } from 'react';
import { metroRunning } from '../audio/metronome';
import { currentRhythm, player, progress, setBpm, setTimer, stepRhythm, toggleRhythm, TIMER_CHOICES } from '../audio/player';
import { TapTempo, tempoRange } from '../audio/tempo';
import { listById } from '../data/playlists';
import { catalog, formatTime, rhythmSubtitle } from '../data/rhythms';
import { useStore } from '../lib/store';
import { Sheet } from './common';
import { Icon } from './icons';
import { Knob } from './Knob';
import { Menu } from './Menu';
import { go } from './nav';

function useNow(active: boolean, ms = 500): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

function LoopBar() {
  const p = useStore(progress);
  const { playing } = useStore(player);
  const frac = p.dur ? Math.min(1, p.pos / p.dur) : 0;
  return (
    <div className="loop">
      <div className="loop-track">
        <div className="loop-fill" style={{ transform: `scaleX(${frac})` }} />
      </div>
      <div className="loop-meta">
        <span>
          {formatTime(p.pos)} / {formatTime(p.dur)}
        </span>
        <span>{playing || p.pos > 0 ? `Tur ${p.loops + 1}` : 'Döngü'}</span>
      </div>
    </div>
  );
}

function TimerSheet({ onClose }: { onClose(): void }) {
  const { timerMin } = useStore(player);
  return (
    <Sheet title="Zamanlayıcı" onClose={onClose}>
      <p className="hint">Seçilen süre dolunca ritim yavaşça kısılıp durur.</p>
      <div className="chip-grid">
        {TIMER_CHOICES.map((m) => (
          <button
            key={m}
            className={m === timerMin ? 'chip on' : 'chip'}
            onClick={() => {
              setTimer(m);
              onClose();
            }}
          >
            {m === 0 ? 'Sınırsız' : `${m} dk`}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function MainScreen() {
  const st = useStore(player);
  const cat = useStore(catalog);
  const metroOn = useStore(metroRunning);
  const [menu, setMenu] = useState(false);
  const [timerSheet, setTimerSheet] = useState(false);
  const tap = useRef(new TapTempo());
  const [tapFlash, setTapFlash] = useState(false);
  const now = useNow(!!st.endsAt);
  const r = cat.loaded ? currentRhythm() : undefined;
  const [lo, hi] = tempoRange(r?.bpm);
  const list = st.queue ? listById(st.queue.listId) : undefined;
  const entry = list?.entries[st.queue!.index];
  const fromList = entry && entry.rhythmId === r?.id ? entry : undefined;
  const pct = r?.bpm ? Math.round((st.bpm / r.bpm) * 100) : 100;

  const onTap = () => {
    const bpm = tap.current.tap(performance.now());
    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 90);
    if (bpm) setBpm(bpm);
  };

  const left = st.endsAt ? Math.max(0, (st.endsAt - now) / 1000) : 0;
  const busy = st.loading;

  return (
    <div className="screen main">
      <header className="bar">
        <div className="brand">
          <span className="brand-dot" />
          Ritim
        </div>
        <div className="bar-right">
          <button className={metroOn ? 'icon-btn lit' : 'icon-btn'} onClick={() => go({ name: 'metronome' })} aria-label="Metronom">
            <Icon name="metronome" />
          </button>
          <button className="icon-btn" onClick={() => go({ name: 'lists' })} aria-label="Listelerim">
            <Icon name="list" />
          </button>
          <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Menü">
            <Icon name="more" />
          </button>
        </div>
      </header>

      <section className="now">
        <button className="step-btn" onClick={() => stepRhythm(-1)} aria-label="Önceki ritim">
          <Icon name="prev" size={28} />
        </button>
        <button className="now-text" onClick={() => go(fromList ? { name: 'list', id: list!.id } : { name: 'library' })}>
          {fromList ? (
            <>
              <span className="now-context">
                {list!.name} · {st.queue!.index + 1}/{list!.entries.length}
              </span>
              <span className="now-title">{fromList.song}</span>
              <span className="now-sub">{r ? `${r.title} · ${rhythmSubtitle(r)}` : ''}</span>
            </>
          ) : (
            <>
              <span className="now-context">{r ? 'Ritim' : ''}</span>
              <span className="now-title">{r ? r.title : cat.loaded ? 'Ritim seçin' : 'Yükleniyor…'}</span>
              <span className="now-sub">{r ? rhythmSubtitle(r) : cat.error ?? 'Dokunun, listeden seçin'}</span>
            </>
          )}
        </button>
        <button className="step-btn" onClick={() => stepRhythm(1)} aria-label="Sonraki ritim">
          <Icon name="next" size={28} />
        </button>
      </section>

      <section className="tempo">
        <Knob value={st.bpm} min={lo} max={hi} onChange={setBpm} marker={r?.bpm} caption={r?.bpm ? `BPM · %${pct}` : 'BPM'} />
        <div className="tempo-row">
          <button className="round-btn" onClick={() => setBpm(st.bpm - 1)} aria-label="Tempo azalt">
            <Icon name="minus" size={28} />
          </button>
          <button className={tapFlash ? 'tap-btn flash' : 'tap-btn'} onPointerDown={onTap}>
            TAP
          </button>
          <button className="round-btn" onClick={() => setBpm(st.bpm + 1)} aria-label="Tempo artır">
            <Icon name="plus" size={28} />
          </button>
        </div>
        <div className="rec-line">
          {r?.bpm ? (
            <button className="link-btn" onClick={() => setBpm(r.bpm!)}>
              Kayıt temposu {r.bpmEstimated ? '≈' : ''}
              {r.bpm}
              {r.bpmTo ? `→${r.bpmTo}` : ''} · sıfırla
            </button>
          ) : (
            <span>&nbsp;</span>
          )}
        </div>
      </section>

      <LoopBar />

      {st.error && <div className="error">{st.error}</div>}

      <button className={st.playing ? 'start-btn on' : 'start-btn'} onClick={toggleRhythm} disabled={!r}>
        {busy ? (
          <span>İndiriliyor {Math.round(st.loadPct * 100)}%</span>
        ) : st.playing ? (
          <>
            <Icon name="stop" size={30} /> STOP
          </>
        ) : (
          <>
            <Icon name="play" size={30} /> START
          </>
        )}
      </button>

      <button className="timer-chip" onClick={() => setTimerSheet(true)}>
        <Icon name="timer" size={20} />
        {st.endsAt ? (
          <span>
            Kalan <b>{formatTime(left)}</b>
            {st.fading ? ' · kısılıyor' : ''}
          </span>
        ) : (
          <span>Süre: {st.timerMin ? `${st.timerMin} dakika` : 'Sınırsız'}</span>
        )}
      </button>

      {timerSheet && <TimerSheet onClose={() => setTimerSheet(false)} />}
      {menu && <Menu onClose={() => setMenu(false)} />}
    </div>
  );
}

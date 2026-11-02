// Result card of the meter finder: meter, usul, beat blocks, tempo, listen
// back (darbuka at the found tempo), alternatives, and the app's rhythms in
// that meter (one tap starts one at the found tempo).

import { useEffect, useRef, useState } from 'react';
import { holdAudio, masterOut, unlockAudio } from '../audio/context';
import { playVoice } from '../audio/drums';
import { player, playRhythm, selectRhythm } from '../audio/player';
import { catalog, formatTime, shownBpm } from '../data/rhythms';
import { useStore } from '../lib/store';
import type { Candidate, MeterResult } from '../olcu/meter';
import { cycleMs, listenPattern, quarterBpm, rhythmsInMeter } from '../olcu/match';
import { Icon } from './icons';
import { home } from './nav';

const CYCLES = 4;

/** Plays a candidate for a few cycles; one at a time. */
function useListenBack(result: MeterResult) {
  const [playing, setPlaying] = useState<string | undefined>(undefined);
  const stopRef = useRef<() => void>();
  const stop = () => {
    stopRef.current?.();
    stopRef.current = undefined;
    setPlaying(undefined);
  };
  useEffect(() => stop, []);
  const play = (c: Candidate) => {
    if (playing === c.name) return stop();
    stop();
    const ctx = unlockAudio();
    holdAudio('olcu', true);
    const out = ctx.createGain();
    out.connect(masterOut());
    const len = cycleMs(result, c) / 1000;
    const t0 = ctx.currentTime + 0.08;
    for (let k = 0; k < CYCLES; k++) for (const x of listenPattern(result, c)) playVoice(ctx, out, x.strong ? 'darbukaDum' : 'darbukaTek', t0 + k * len + x.at / 1000, x.strong ? 1 : 0.8);
    const timer = setTimeout(stop, (CYCLES * len + 0.4) * 1000);
    stopRef.current = () => {
      clearTimeout(timer);
      out.disconnect();
      holdAudio('olcu', false);
    };
    setPlaying(c.name);
  };
  return { playing, play };
}

function Blocks({ c, even }: { c: Candidate; even: boolean }) {
  return (
    <div className="ob-blocks">
      {c.groups.map((g, i) => (
        <span key={i} className={`ob-blk${i === 0 ? ' first' : ''}${!even && g === 3 ? ' long' : ''}`} style={{ flex: even ? 1 : g }}>
          {even ? (i === 0 ? 'DÜM' : 'tek') : g}
        </span>
      ))}
    </div>
  );
}

export function OlcuResult({ result, guess }: { result: MeterResult; guess: boolean }) {
  const cat = useStore(catalog);
  const pl = useStore(player);
  const { playing, play } = useListenBack(result);
  const best = result.candidates[0];
  const even = result.kind === 'even';
  const unclear = result.kind === 'unclear';
  const conf = unclear ? 'Belirsiz' : guess ? 'Tahmin' : result.cycles >= 4 && best.fit >= 0.9 ? 'Kesin' : result.cycles >= 2.5 ? 'Büyük ihtimalle' : 'İlk tahmin';
  const tempo = even && !best.meter.endsWith('/8') ? `♩ ${Math.round(result.bpm)}` : `♪ ${Math.round(result.bpm)} (sekizlik)`;
  const alts = result.candidates.slice(1, 4).filter((c) => c.score > 0.25);
  const qb = quarterBpm(result, best);
  const rhythms = unclear ? [] : rhythmsInMeter(cat.rhythms, best.meter);

  const start = (id: string) => {
    selectRhythm(id, { bpm: qb });
    if (!player.get().playing && !player.get().loading) playRhythm();
    home();
  };

  return (
    <section className="ob-result" aria-live="polite">
      <div className="ob-top">
        <span className={`ob-conf${unclear ? ' warn' : conf === 'Kesin' ? ' ok' : ''}`}>{conf}</span>
        <span className="ob-tempo">{tempo}</span>
      </div>
      <div className="ob-meter">{unclear ? '?' : best.meter}</div>
      <div className="ob-usul">{unclear ? 'Vuruşlar henüz bir kalıba oturmadı' : best.name}</div>
      {!unclear && <Blocks c={best} even={even} />}
      <p className="ob-msg">{result.message}</p>
      {guess && !unclear && <p className="ob-msg">Kayıttan bulunan ölçü bir tahmindir; dinleyip türküyle karşılaştırın. İki katı (ör. 5/8 yerine 10/8) da çıkabilir.</p>}
      {!unclear && (
        <button className="ob-listen" onClick={() => play(best)}>
          <Icon name={playing === best.name ? 'stop' : 'play'} size={20} /> {playing === best.name ? 'Durdur' : 'Bu tempoda dinle ve karşılaştır'}
        </button>
      )}
      {alts.length > 0 && (
        <div className="ob-alts">
          <span>Oturmadıysa bunları dinleyin:</span>
          {alts.map((c) => (
            <button key={c.name} className={playing === c.name ? 'chip on' : 'chip'} onClick={() => play(c)}>
              {c.meter} · {c.name}
              {playing === c.name ? ' ■' : ''}
            </button>
          ))}
        </div>
      )}
      {!unclear && (
        <div className="ob-rhythms">
          <h3>Bu ölçüdeki ritimler</h3>
          {rhythms.length ? (
            <>
              <p className="hint">Dokununca bulunan tempoda (♩ {qb}) çalmaya başlar.</p>
              {rhythms.map((r) => (
                <button key={r.id} className={pl.rhythmId === r.id ? 'row-main ob-rrow on' : 'row-main ob-rrow'} onClick={() => start(r.id)}>
                  <span className="row-title">{r.title}</span>
                  <span className="row-sub">
                    {r.meter} · kayıt {shownBpm(r)} BPM · {formatTime(r.duration)}
                  </span>
                </button>
              ))}
            </>
          ) : (
            <p className="hint">Uygulamada {best.meter} ölçüsünde ritim yok. Metronomda bu usulü seçerek çalışabilirsiniz.</p>
          )}
        </div>
      )}
    </section>
  );
}

/** "Kulakla ölçü nasıl bulunur?" — the k / U table. */
export function OlcuGuide() {
  const rows: [string, string, string][] = [
    ['k U', '2+3', '5/8 Türk aksağı'],
    ['U k k', '3+2+2', '7/8 Devr-i hindî'],
    ['k k U', '2+2+3', '7/8'],
    ['k k k U', '2+2+2+3', '9/8 Karşılama'],
    ['U k k k', '3+2+2+2', '9/8'],
    ['U k k U', '3+2+2+3', '10/8 Aksak semai'],
    ['hepsi eşit', '2 ya da 4 vuruş', '2/4 · 4/4 düz'],
  ];
  return (
    <details className="card ob-guide">
      <summary>Kulakla ölçü nasıl bulunur?</summary>
      <p>
        Aksak ölçülerde iki çeşit vuruş vardır: kısa vuruş (<b>k</b>) 2 sekizlik, topal yani uzun vuruş (<b>U</b>) 3 sekizlik sürer. Uzun vuruş kısanın bir buçuk katıdır. Bir
        döngüdeki kısaları 2, uzunları 3 sayıp toplayın; ölçü budur.
      </p>
      <table>
        <thead>
          <tr>
            <th>Duyulan</th>
            <th>Toplam</th>
            <th>Ölçü</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b, c]) => (
            <tr key={a}>
              <td>
                <code>{a}</code>
              </td>
              <td>{b}</td>
              <td>{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Sayarken uzun vuruşu “bir-iki-üç” diye uzatın: “bir-iki, bir-iki, bir-iki, bir-iki-üç” türküyle oturuyorsa 9/8’dir.</p>
    </details>
  );
}


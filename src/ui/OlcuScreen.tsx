// "Ölçü Bul": find a türkü's meter by tapping along (Vurarak), by listening
// through the microphone (Dinleyerek) or from a recording file (Kayıttan).

import { useEffect, useRef, useState } from 'react';
import { audioContext, masterOut, unlockAudio } from '../audio/context';
import { playVoice } from '../audio/drums';
import { metronome, metroRunning } from '../audio/metronome';
import { player, stopRhythm } from '../audio/player';
import { cancelRecording, record, recorder, stopRecording } from '../audio/recorder';
import { useStore } from '../lib/store';
import { analyseFile, analyseSamples } from '../olcu/input';
import { analyseTaps, MIN_TAPS, type MeterResult, type Tap } from '../olcu/meter';
import { Header } from './common';
import { Icon } from './icons';
import { OlcuGuide, OlcuResult } from './OlcuResult';

type Mode = 'vur' | 'dinle' | 'kayit';

const RECORD_S = 18;
const MIN_RECORD_S = 7;

function TapMode({ onResult }: { onResult(r: MeterResult | undefined): void }) {
  const [taps, setTaps] = useState<Tap[]>([]);
  const [result, setResult] = useState<MeterResult | undefined>(undefined);
  const [hit, setHit] = useState('');

  const tap = (accent: boolean) => {
    const now = performance.now();
    const ctx = unlockAudio();
    playVoice(ctx, masterOut(), accent ? 'darbukaDum' : 'darbukaTek', ctx.currentTime, accent ? 1 : 0.8);
    // A long pause starts a new attempt.
    const next = taps.length && now - taps[taps.length - 1].t > 4000 ? [{ t: now, accent }] : [...taps, { t: now, accent }];
    setTaps(next);
    const r = analyseTaps(next);
    setResult(r);
    onResult(r);
    setHit(accent ? 'hit-strong' : 'hit');
    setTimeout(() => setHit(''), 150);
  };

  const reset = () => {
    setTaps([]);
    setResult(undefined);
    onResult(undefined);
  };

  const gaps = taps.slice(1).map((x, i) => x.t - taps[i].t).slice(-24);
  const max = Math.max(1, ...gaps);
  const labels = result?.labels.slice(-gaps.length) ?? [];
  const left = Math.max(0, MIN_TAPS - taps.length);

  return (
    <>
      <p className="hint center">Türküyü çalın, her vuruşta büyük daireye dokunun. Döngünün ilk, en güçlü vuruşunda DÜM'e basın. Topal (uzun) vuruşu olduğu gibi bekleyin.</p>
      <div className="ob-padrow">
        <button className={`ob-pad ${hit}`} onPointerDown={(e) => (e.preventDefault(), tap(false))} aria-label="Vuruş">
          <b>VUR</b>
          <span>her vuruşta dokunun</span>
        </button>
        <div className="ob-row2">
          <button className="ob-dum" onPointerDown={(e) => (e.preventDefault(), tap(true))}>
            DÜM · vurgulu
          </button>
          <button className="ghost-btn" onClick={reset}>
            Baştan başla
          </button>
        </div>
        <span className="muted">{taps.length} vuruş</span>
      </div>
      <div className="ob-gaps" aria-label="Vuruş aralıkları">
        {gaps.length ? (
          gaps.map((g, i) => {
            const l = result?.kind === 'aksak' ? labels[i] : undefined;
            return (
              <span key={i} className={`ob-bar${l === 3 ? ' long' : l === 2 ? ' short' : ''}`} style={{ height: `${Math.max(14, (g / max) * 100)}%` }}>
                <i>{l === 3 ? 'U' : l === 2 ? 'k' : ''}</i>
              </span>
            );
          })
        ) : (
          <span className="hint">Vuruşlar burada çubuk olarak görünür: kısa vuruş kısa (k), topal vuruş uzun (U) çubuk.</span>
        )}
      </div>
      {!result && (
        <div className="ob-waiting">
          <b>{taps.length ? `${left} vuruş daha` : 'Türküyü açın ve vurmaya başlayın'}</b>
          <span>Sonuç {MIN_TAPS} vuruştan sonra çıkar; ne kadar çok vurursanız o kadar kesinleşir.</span>
        </div>
      )}
    </>
  );
}

function ListenMode({ onResult }: { onResult(r: MeterResult | undefined): void }) {
  const rec = useStore(recorder);
  const pl = useStore(player);
  const metroOn = useStore(metroRunning);
  const [status, setStatus] = useState('');
  useEffect(() => () => cancelRecording(), []);

  const start = async () => {
    // Our own rhythm/metronome would be recorded too.
    if (player.get().playing) stopRhythm();
    if (metroRunning.get()) metronome.stop();
    onResult(undefined);
    setStatus('');
    const got = await record(RECORD_S);
    if (!got) return;
    if (got.samples.length < got.sampleRate * MIN_RECORD_S) {
      setStatus(`Kayıt çok kısa; en az ${MIN_RECORD_S} saniye dinletin.`);
      return;
    }
    setStatus('Dinlenen kayıt inceleniyor…');
    await new Promise((r) => setTimeout(r, 30));
    const r = analyseSamples(got.samples, got.sampleRate);
    if (!r) setStatus('Ritim duyulamadı. Telefonu müziğe yaklaştırıp tekrar deneyin.');
    else setStatus('');
    onResult(r);
  };

  const left = Math.max(0, Math.ceil(RECORD_S - rec.seconds));
  return (
    <>
      <p className="hint center">Türküyü (hoparlörden ya da canlı) çalın, telefonu yaklaştırın ve dinlemeyi başlatın. {RECORD_S} saniye dinler. Davul, darbuka ya da sazın belirgin olduğu yerler en iyi sonucu verir.</p>
      {(pl.playing || metroOn) && !rec.recording && <p className="hint center">Çalan ritim / metronom dinlemeye başlayınca durdurulur.</p>}
      {rec.recording ? (
        <div className="ob-rec">
          <div className="ob-count">{left}</div>
          <span>saniye kaldı · dinleniyor</span>
          <div className="ob-level">
            <i style={{ transform: `scaleX(${Math.max(0.02, rec.level)})` }} />
          </div>
          <span className="hint">{rec.level < 0.05 ? 'Ses çok düşük: telefonu müziğe yaklaştırın.' : 'Ses geliyor.'}</span>
          <button className="ghost-btn" disabled={rec.seconds < MIN_RECORD_S} onClick={stopRecording}>
            Bitir ve sonucu göster
          </button>
        </div>
      ) : (
        <button className="start-btn" onClick={() => void start()}>
          <Icon name="tuner" size={26} /> DİNLE ({RECORD_S} sn)
        </button>
      )}
      {rec.error && <div className="error">{rec.error}</div>}
      {status && <p className="hint center">{status}</p>}
    </>
  );
}

function FileMode({ onResult }: { onResult(r: MeterResult | undefined): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const pick = async (f: File) => {
    onResult(undefined);
    setStatus(`“${f.name}” dinleniyor…`);
    try {
      const { result, seconds } = await analyseFile(audioContext(), f);
      if (!result) {
        setStatus('Kayıt çok kısa (en az 7 saniye gerekli) ya da ritim duyulamadı.');
        return;
      }
      setStatus(`“${f.name}” dinlendi (${seconds} sn).`);
      onResult(result);
    } catch {
      setStatus('Bu dosya açılamadı. MP3, M4A ya da WAV deneyin.');
    }
  };
  return (
    <>
      <p className="hint center">Türkünün kaydını (MP3, M4A, WAV) seçin; program ritmi kayıttan dinleyip tahmin eder.</p>
      <button className="start-btn" onClick={() => input.current?.click()}>
        <Icon name="upload" size={26} /> Kayıt seç
      </button>
      <input
        ref={input}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = '';
        }}
      />
      {status && <p className="hint center">{status}</p>}
    </>
  );
}

export function OlcuScreen() {
  const [mode, setMode] = useState<Mode>('vur');
  const [result, setResult] = useState<MeterResult | undefined>(undefined);
  const switchMode = (m: Mode) => {
    if (m === mode) return;
    cancelRecording();
    setResult(undefined);
    setMode(m);
  };
  return (
    <div className="screen">
      <Header title="Ölçü Bul" />
      <div className="scroll ob">
        <div className="segmented wide" role="tablist">
          {(
            [
              ['vur', 'Vurarak'],
              ['dinle', 'Dinleyerek'],
              ['kayit', 'Kayıttan'],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => switchMode(m)}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'vur' && <TapMode onResult={setResult} />}
        {mode === 'dinle' && <ListenMode onResult={setResult} />}
        {mode === 'kayit' && <FileMode onResult={setResult} />}
        {result && <OlcuResult result={result} guess={mode !== 'vur'} />}
        <OlcuGuide />
      </div>
    </div>
  );
}

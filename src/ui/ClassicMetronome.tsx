// Classic wind-up pyramid metronome (walnut case, black lacquered front,
// gold Maelzel scale). The pendulum swings to one side on every pulse; the
// brass weight shows the tempo and can be dragged like on the real thing.

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { metroBpm, metronome, metroRunning } from '../audio/metronome';
import { useStore } from '../lib/store';

const MAELZEL = [40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 63, 66, 69, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120, 126, 132, 138, 144, 152, 160, 168, 176, 184, 192, 200, 208];
const NAMES: [string, number][] = [
  ['Largo', 50],
  ['Larghetto', 63],
  ['Adagio', 71],
  ['Andante', 92],
  ['Moderato', 114],
  ['Allegro', 144],
  ['Presto', 184],
  ['Prestissimo', 204],
];

const TOP = 62;
const SPAN = 214;
const PIVOT_Y = 304;
const SWING = 26;

/** Scale position of a tempo (slow at the top, like the real weight). */
const yOf = (bpm: number): number => TOP + (Math.log(Math.max(40, Math.min(208, bpm)) / 40) / Math.log(208 / 40)) * SPAN;
const bpmOf = (y: number): number => 40 * Math.exp(((Math.max(TOP, Math.min(TOP + SPAN, y)) - TOP) / SPAN) * Math.log(208 / 40));

export const tempoName = (bpm: number): string => {
  let name = NAMES[0][0];
  for (const [n, upTo] of NAMES) {
    name = n;
    if (bpm <= upTo) break;
  }
  return name;
};

function Grain({ clip }: { clip: string }) {
  // Wood grain: wavy lines fanning out with the pyramid, darker and lighter streaks.
  const lines = [];
  for (let i = 0; i < 18; i++) {
    const x0 = 119 + i * 3.6;
    const x1 = 40 + i * 13;
    const w = (i % 3) - 1;
    const d = `M ${x0} 30 C ${x0 + w * 4} 140, ${x1 - w * 9} 260, ${x1} 410`;
    lines.push(<path key={`d${i}`} d={d} stroke="#2a1208" strokeOpacity={0.28} strokeWidth={i % 4 === 0 ? 1.6 : 0.8} fill="none" />);
    if (i % 2) lines.push(<path key={`l${i}`} d={d} transform="translate(2 0)" stroke="#c98250" strokeOpacity={0.14} strokeWidth={0.7} fill="none" />);
  }
  return <g clipPath={`url(#${clip})`}>{lines}</g>;
}

/** `onToggle`: START/STOP, built into the wooden base as a brass plate. */
export function ClassicMetronome({ bpm, onChange, onToggle }: { bpm: number; onChange(v: number): void; onToggle(): void }) {
  const running = useStore(metroRunning);
  const [angle, setAngle] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef(false);

  useEffect(() => {
    if (!running) {
      setAngle(0);
      return;
    }
    let raf = 0;
    const loop = () => {
      const v = metronome.current();
      const t = metronome.now();
      if (v) {
        const p = 60 / metroBpm();
        const x = Math.max(0, Math.min(1, (t - v.time) / p));
        setAngle(SWING * (v.n % 2 ? -1 : 1) * Math.cos(Math.PI * x));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const yFromEvent = (e: PointerEvent): number => {
    const r = svg.current!.getBoundingClientRect();
    return ((e.clientY - r.top) / r.height) * 430;
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    const y = yFromEvent(e);
    if (y < TOP - 20 || y > TOP + SPAN + 20) return;
    drag.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(Math.round(bpmOf(y)));
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current) onChange(Math.round(bpmOf(yFromEvent(e))));
  };
  const up = () => {
    drag.current = false;
  };

  const yw = yOf(bpm);
  return (
    <div className="classic">
      <div className="classic-stage">
      <svg
        ref={svg}
        className="classic-svg"
        viewBox="0 0 300 430"
        role="slider"
        aria-label="Metronom temposu (ağırlığı kaydırın)"
        aria-valuenow={bpm}
        aria-valuemin={40}
        aria-valuemax={208}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <defs>
          <linearGradient id="mwood" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#3a1a0c" />
            <stop offset="0.18" stopColor="#6e381b" />
            <stop offset="0.45" stopColor="#93502b" />
            <stop offset="0.72" stopColor="#6c351a" />
            <stop offset="1" stopColor="#35170a" />
          </linearGradient>
          <linearGradient id="mwood2" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#7a4022" />
            <stop offset="1" stopColor="#4e240f" />
          </linearGradient>
          <linearGradient id="mlacquer" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#0b0b0c" />
            <stop offset="0.5" stopColor="#24252a" />
            <stop offset="1" stopColor="#0b0b0c" />
          </linearGradient>
          <linearGradient id="mbrass" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#fff1b8" />
            <stop offset="0.35" stopColor="#e2b44c" />
            <stop offset="0.7" stopColor="#a87818" />
            <stop offset="1" stopColor="#6e4c0c" />
          </linearGradient>
          <linearGradient id="msteel" x1="0" x2="1">
            <stop offset="0" stopColor="#8b9096" />
            <stop offset="0.5" stopColor="#f2f4f6" />
            <stop offset="1" stopColor="#7c8187" />
          </linearGradient>
          <radialGradient id="mshine" cx="0.35" cy="0.2" r="0.9">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <clipPath id="mcase">
            <polygon points="118,34 182,34 262,404 38,404" />
          </clipPath>
          <clipPath id="mbox">
            <polygon points="70,306 230,306 258,404 42,404" />
          </clipPath>
        </defs>

        <ellipse cx="150" cy="417" rx="128" ry="8" fill="#000" opacity="0.45" />
        {/* Case */}
        <polygon points="118,34 182,34 262,404 38,404" fill="url(#mwood)" />
        <Grain clip="mcase" />
        <polygon points="118,34 182,34 262,404 38,404" fill="url(#mshine)" />
        {/* Cap and finial */}
        <polygon points="110,22 190,22 185,36 115,36" fill="url(#mwood2)" stroke="#2a1208" strokeWidth="0.8" />
        <polygon points="128,22 172,22 160,9 140,9" fill="#5a2c14" stroke="#2a1208" strokeWidth="0.8" />
        {/* Black lacquered front */}
        <polygon points="126,46 174,46 223,300 77,300" fill="url(#mlacquer)" stroke="#000" strokeWidth="1" />
        <polygon points="128,48 140,48 92,298 80,298" fill="#fff" opacity="0.04" />
        {/* Lower box front */}
        <polygon points="70,306 230,306 258,404 42,404" fill="url(#mwood2)" />
        <g opacity="0.7">
          <Grain clip="mbox" />
        </g>
        <line x1="66" y1="305" x2="234" y2="305" stroke="#2a1208" strokeWidth="3" />
        <line x1="66" y1="307.5" x2="234" y2="307.5" stroke="#b9774a" strokeOpacity="0.35" strokeWidth="1" />
        {/* Feet and winding key */}
        <rect x="44" y="402" width="24" height="9" rx="3" fill="#111" />
        <rect x="232" y="402" width="24" height="9" rx="3" fill="#111" />
        <rect x="252" y="352" width="10" height="4" fill="#9a7a2c" />
        <circle cx="265" cy="354" r="6" fill="url(#mbrass)" stroke="#5c3f0a" strokeWidth="0.8" />

        {/* Maelzel scale */}
        <rect x="138" y={TOP - 8} width="24" height={SPAN + 16} fill="#070707" stroke="#c9a43a" strokeWidth="0.7" />
        {MAELZEL.map((b, i) => {
          const y = yOf(b);
          return (
            <g key={b}>
              <line x1="139.5" x2="143" y1={y} y2={y} stroke="#d9b54a" strokeWidth="0.6" />
              <line x1="157" x2="160.5" y1={y} y2={y} stroke="#d9b54a" strokeWidth="0.6" />
              <text x="150" y={y + 1.8} className="mscale" opacity={i % 2 ? 0.85 : 1}>
                {b}
              </text>
            </g>
          );
        })}
        {NAMES.map(([n, upTo], i) => {
          const from = i ? NAMES[i - 1][1] : 40;
          return (
            <text key={n} x="166" y={yOf((from + upTo) / 2) + 2} className="mname">
              {n}
            </text>
          );
        })}
        <text x="150" y="296" className="memblem">
          M
        </text>

        {/* Pendulum: steel rod, brass weight, pivot */}
        <g transform={`rotate(${angle} 150 ${PIVOT_Y})`}>
          <rect x="148.4" y="38" width="3.2" height={PIVOT_Y - 38} rx="1.2" fill="url(#msteel)" />
          <rect x="147.6" y="36" width="4.8" height="6" rx="1" fill="#c7cbd0" />
          <g className="mweight">
            <polygon points={`138,${yw - 10} 162,${yw - 10} 159,${yw + 10} 141,${yw + 10}`} fill="url(#mbrass)" stroke="#6e4c0c" strokeWidth="0.8" />
            <rect x="141" y={yw - 8} width="5" height="16" fill="#fff" opacity="0.35" />
            <line x1="138" x2="162" y1={yw - 10} y2={yw - 10} stroke="#fff3c4" strokeWidth="1" />
          </g>
        </g>
        <circle cx="150" cy={PIVOT_Y} r="4.5" fill="#bfc3c8" stroke="#555" strokeWidth="0.8" />
      </svg>
      <button className={running ? 'classic-start on' : 'classic-start'} onClick={onToggle} aria-label={running ? 'Metronomu durdur' : 'Metronomu başlat'}>
        <span className="classic-lamp" />
        {running ? 'STOP' : 'START'}
      </button>
      </div>
      <div className="classic-readout">
        <span className="classic-bpm">♩ = {bpm}</span>
        <span className="classic-name">{tempoName(bpm)}</span>
      </div>
    </div>
  );
}

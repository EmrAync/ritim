// Rotary tempo knob: turn by dragging around the centre (or wheel / arrow
// keys). 270° sweep between min and max; shows the value in the middle.

import { useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';

interface Props {
  value: number;
  min: number;
  max: number;
  onChange(v: number): void;
  /** Small marker on the ring (the recorded tempo). */
  marker?: number;
  caption?: string;
  label?: string;
}

const SWEEP = 270;
const START = -135;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export function Knob({ value, min, max, onChange, marker, caption, label = 'Tempo' }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ angle: number; acc: number } | null>(null);
  const span = Math.max(1, max - min);
  const frac = Math.max(0, Math.min(1, (value - min) / span));
  const deg = START + frac * SWEEP;

  const angleOf = (e: PointerEvent): number | undefined => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.08) return undefined;
    return (Math.atan2(dx, -dy) * 180) / Math.PI;
  };

  const down = (e: PointerEvent<SVGSVGElement>) => {
    const a = angleOf(e);
    if (a === undefined) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { angle: a, acc: value };
  };

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const a = angleOf(e);
    if (a === undefined) return;
    let delta = a - d.angle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    d.angle = a;
    d.acc = Math.max(min, Math.min(max, d.acc + (delta / SWEEP) * span));
    const v = Math.round(d.acc);
    if (v !== value) onChange(v);
  };

  const up = () => {
    drag.current = null;
  };

  const wheel = (e: WheelEvent) => onChange(Math.max(min, Math.min(max, value + (e.deltaY < 0 ? 1 : -1))));

  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(Math.min(max, value + step));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(Math.max(min, value - step));
    else return;
    e.preventDefault();
  };

  const C = 100;
  const [kx, ky] = polar(C, C, 58, deg);
  const ticks = Array.from({ length: 28 }, (_, i) => START + (i / 27) * SWEEP);
  const mDeg = marker !== undefined && marker >= min && marker <= max ? START + ((marker - min) / span) * SWEEP : undefined;

  return (
    <svg
      ref={ref}
      className="knob"
      viewBox="0 0 200 200"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onWheel={wheel}
      onKeyDown={key}
    >
      {ticks.map((t, i) => {
        const [x0, y0] = polar(C, C, 93, t);
        const [x1, y1] = polar(C, C, i % 3 === 0 ? 86 : 89, t);
        return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className={t <= deg ? 'knob-tick on' : 'knob-tick'} />;
      })}
      <path d={arc(C, C, 78, START, START + SWEEP)} className="knob-track" />
      <path d={arc(C, C, 78, START, Math.max(START + 0.5, deg))} className="knob-value" />
      {mDeg !== undefined && (() => {
        const [x0, y0] = polar(C, C, 70, mDeg);
        const [x1, y1] = polar(C, C, 86, mDeg);
        return <line x1={x0} y1={y0} x2={x1} y2={y1} className="knob-marker" />;
      })()}
      <circle cx={C} cy={C} r={66} className="knob-body" />
      <circle cx={kx} cy={ky} r={5} className="knob-dot" />
      <text x={C} y={C + 6} className="knob-num">{value}</text>
      <text x={C} y={C + 30} className="knob-unit">{caption ?? 'BPM'}</text>
    </svg>
  );
}

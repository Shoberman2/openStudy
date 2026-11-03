"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { PlotBlock as Plot } from "@/engine/tutor/blocks";
import { autoRange, compile, fmt, sample, ticks } from "@/engine/tutor/expr";

const W = 640;
const H = 360;
const PAD = { l: 76, r: 16, t: 12, b: 46 };
const COLORS = ["var(--ink)", "var(--blue)", "var(--green)", "var(--red)"];

export function PlotBlock({ block }: { block: Plot }) {
  const [vals, setVals] = useState(() => Object.fromEntries(block.sliders.map((s) => [s.name, s.value])));
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const clip = useId();
  const curves = useMemo(() => block.curves.map((c) => ({ ...c, fn: compile(c.expr) })), [block.curves]);
  const [x0, x1] = block.domain;

  const view = useMemo(() => {
    const first = curves.map((c) => sample(c.fn, block.variable, x0, x1, vals));
    const [y0, y1] = block.range ?? autoRange(first.flat(2).map((p) => p.y));
    const span = y1 - y0;
    const lines = curves.map((c) => sample(c.fn, block.variable, x0, x1, vals, 320, span * 3));
    return { y0, y1, lines };
  }, [curves, block.variable, block.range, x0, x1, vals]);

  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => PAD.t + (1 - (y - view.y0) / (view.y1 - view.y0)) * (H - PAD.t - PAD.b);
  const clampY = (y: number) => Math.max(-200, Math.min(H + 200, sy(y)));
  const path = (seg: { x: number; y: number }[]) => seg.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${clampY(p.y).toFixed(1)}`).join("");

  const track = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((clientX - box.left) / box.width) * W;
    setHover(Math.max(x0, Math.min(x1, x0 + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (x1 - x0))));
  };
  const zeroX = x0 <= 0 && x1 >= 0;
  const zeroY = view.y0 <= 0 && view.y1 >= 0;

  return (
    <figure data-testid="plot">
      <figcaption className="mb-2 text-[18px] font-semibold text-ink">{block.title}</figcaption>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-pan-y select-none"
        role="img"
        aria-label={`Graph of ${block.curves.map((c) => c.label).join(" and ")}`}
        onPointerMove={(e) => track(e.clientX)}
        onPointerDown={(e) => track(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clip}>
            <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} />
          </clipPath>
        </defs>
        {ticks(x0, x1).map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--line)" />
            <text x={sx(t)} y={H - PAD.b + 28} textAnchor="middle" fill="var(--muted)" className="mono plot-tick">
              {fmt(t)}
            </text>
          </g>
        ))}
        {ticks(view.y0, view.y1, 5).map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} stroke="var(--line)" />
            <text x={PAD.l - 8} y={sy(t) + 6} textAnchor="end" fill="var(--muted)" className="mono plot-tick">
              {fmt(t)}
            </text>
          </g>
        ))}
        {zeroX && <line x1={sx(0)} x2={sx(0)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" />}
        {zeroY && <line x1={PAD.l} x2={W - PAD.r} y1={sy(0)} y2={sy(0)} stroke="var(--muted)" />}
        <g clipPath={`url(#${CSS.escape(clip)})`}>
          {view.lines.map((segs, i) =>
            segs.map((seg, j) => <path key={`${i}-${j}`} d={path(seg)} fill="none" stroke={COLORS[i]} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />),
          )}
          {hover !== null && <line x1={sx(hover)} x2={sx(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeDasharray="4 4" />}
        </g>
      </svg>
      <div className="mt-1 flex min-h-[26px] flex-wrap gap-x-4 text-[15px] text-muted">
        {block.xLabel || block.yLabel ? (
          <span>
            {block.xLabel ?? block.variable} across, {block.yLabel ?? "value"} up
          </span>
        ) : null}
        {curves.map((c, i) => (
          <span key={c.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: COLORS[i] }} />
            {c.label}
            {hover !== null && <span className="mono text-ink">{fmt(c.fn.eval({ ...vals, [block.variable]: hover }))}</span>}
          </span>
        ))}
        {hover !== null && <span className="mono">at {block.variable} = {fmt(hover)}</span>}
      </div>
      {block.sliders.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 sm:gap-x-6">
          {block.sliders.map((s) => (
            <label key={s.name} className="block text-[15px] text-muted">
              <span className="flex justify-between gap-3">
                <span>{s.label}</span>
                <span className="mono text-ink">{fmt(vals[s.name])}</span>
              </span>
              <input
                className="slider"
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={vals[s.name]}
                aria-label={s.label}
                onChange={(e) => setVals((v) => ({ ...v, [s.name]: Number(e.target.value) }))}
              />
            </label>
          ))}
        </div>
      )}
      {block.hint && <p className="mt-2 text-[16px] text-muted">{block.hint}</p>}
    </figure>
  );
}

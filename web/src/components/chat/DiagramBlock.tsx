"use client";

import { useEffect, useRef, useState } from "react";
import type { DiagramBlock as Diagram } from "@/engine/tutor/blocks";
import { layoutDiagram, type Placed } from "@/engine/tutor/diagram";

/** A soft S curve from the bottom of one node to the top of the next, or sideways on the same row. */
function wire(a: Placed, b: Placed): string {
  if (a.y === b.y) {
    const [l, r] = a.x < b.x ? [a, b] : [b, a];
    return `M${l.x + l.w} ${l.y + l.h / 2}L${r.x} ${r.y + r.h / 2}`;
  }
  const down = b.y > a.y;
  const [x1, y1, x2, y2] = [a.x + a.w / 2, down ? a.y + a.h : a.y, b.x + b.w / 2, down ? b.y : b.y + b.h];
  const m = (y1 + y2) / 2;
  return `M${x1} ${y1}C${x1} ${m},${x2} ${m},${x2} ${y2}`;
}

export function DiagramBlock({ block }: { block: Diagram }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lay = width ? layoutDiagram(block, width) : null;
  const detail = block.nodes.find((n) => n.id === open)?.detail;

  return (
    <figure data-testid="diagram">
      <figcaption className="mb-3 text-[18px] font-semibold text-ink">{block.title}</figcaption>
      <div ref={box} className="relative w-full" style={{ height: lay?.height ?? 120 }}>
        {lay && (
          <>
            <svg width={lay.width} height={lay.height} className="absolute inset-0" aria-hidden>
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10z" fill="var(--muted)" />
                </marker>
              </defs>
              {lay.wires.map((w, i) => (
                <path key={i} d={wire(w.from, w.to)} fill="none" stroke="var(--muted)" strokeWidth={1.5} markerEnd="url(#arrow)" />
              ))}
            </svg>
            {lay.wires.map(
              (w, i) =>
                w.label && (
                  <span
                    key={i}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper px-1.5 text-[14px] text-muted"
                    style={{ left: (w.from.x + w.from.w / 2 + w.to.x + w.to.w / 2) / 2, top: (w.from.y + w.from.h + w.to.y) / 2 }}
                  >
                    {w.label}
                  </span>
                ),
            )}
            {lay.nodes.map((n) => {
              const tappable = !!n.detail;
              return (
                <button
                  key={n.id}
                  disabled={!tappable}
                  aria-expanded={tappable ? open === n.id : undefined}
                  onClick={() => setOpen(open === n.id ? null : n.id)}
                  className={`absolute flex items-center justify-center rounded-[14px] px-2 text-center text-[15px] font-semibold leading-tight text-ink ${open === n.id ? "bg-ink !text-paper" : "bg-shelf"} ${tappable ? "cursor-pointer" : "cursor-default"}`}
                  style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                >
                  {n.label}
                </button>
              );
            })}
          </>
        )}
      </div>
      <p className="mt-3 min-h-[26px] text-[16px] text-muted" aria-live="polite">
        {detail ?? (block.nodes.some((n) => n.detail) ? "Tap a box to see more." : "")}
      </p>
    </figure>
  );
}

"use client";

import { Flame, Gem, Quote, X } from "lucide-react";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import type { Project } from "@/engine/types";

export function ProgressBar({ value, color = "blue", label }: { value: number; color?: "blue" | "green" | "yellow"; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
      <span style={{ width: `${pct}%`, ["--fill" as string]: `var(--${color})`, minWidth: pct > 0 ? 20 : 0 }} />
    </div>
  );
}

export function Ring({ value, size = 44, stroke = 6, color = "var(--yellow)", children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--shelf)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: "stroke-dashoffset 600ms ease-out" }}
          opacity={v > 0 ? 1 : 0}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

export function StreakPill({ streak }: { streak: number }) {
  return (
    <div className="flex items-center gap-1.5 font-extrabold" title={`${streak} day streak`}>
      <Flame size={24} strokeWidth={2.5} className={streak > 0 ? "text-yellow" : "text-muted"} fill={streak > 0 ? "var(--yellow)" : "none"} />
      <span className={streak > 0 ? "" : "text-muted"}>{streak}</span>
    </div>
  );
}

export function XpPill({ xp }: { xp: number }) {
  return (
    <div className="flex items-center gap-1.5 font-extrabold" title={`${xp} XP`}>
      <Gem size={22} strokeWidth={2.5} className="text-blue" />
      <span>{xp} XP</span>
    </div>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-black text-[20px] tracking-tight text-ink no-underline">
      <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-[9px] bg-blue text-white" style={{ boxShadow: "0 3px 0 var(--blue-lip)" }}>
        <span className="absolute left-[7px] top-[6px] h-[19px] w-[5px] rounded-[2px] bg-white" />
        <span className="absolute left-[14px] top-[9px] h-[16px] w-[5px] rounded-[2px] bg-white/80" />
        <span className="absolute left-[21px] top-[7px] h-[18px] w-[4px] rounded-[2px] bg-yellow" />
      </span>
      OpenStudy
    </Link>
  );
}

export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={label}>
      <button aria-label="Close" className="absolute inset-0 bg-black/40 cursor-default" onClick={onClose} />
      <div className="anim-sheet relative w-full max-w-[560px] max-h-[88dvh] overflow-y-auto rounded-t-[24px] sm:rounded-[24px] bg-paper p-5 pb-8 sm:p-7 border-2 border-line">
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full p-1.5 text-muted hover:bg-shelf">
          <X size={22} strokeWidth={2.5} />
        </button>
        {children}
      </div>
    </div>
  );
}

function spineFooter(p: Pick<Project, "author" | "type" | "goalDate">): string {
  if (p.type === "class" && p.goalDate) {
    const [y, m, d] = p.goalDate.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (p.type === "class") return "Class";
  return p.author ? p.author.split(" ").slice(-1)[0] : "";
}

export function BookSpine({ project, href, height = 220, onClick }: { project: Pick<Project, "title" | "author" | "color" | "type" | "goalDate">; href?: string; height?: number; onClick?: () => void }) {
  const inner = (
    <>
      <span className="spine-title" style={{ maxHeight: height - 70 }}>{project.title}</span>
      <span className="spine-author">{spineFooter(project)}</span>
    </>
  );
  const cls = `spine spine-${project.color}`;
  if (href)
    return (
      <Link href={href} className={cls} style={{ height }} aria-label={`${project.title}${project.author ? ` by ${project.author}` : ""}`}>
        {inner}
      </Link>
    );
  return (
    <div className={cls} style={{ height }} onClick={onClick} aria-label={project.title}>
      {inner}
    </div>
  );
}

/** A path node: 72px circle with a 5 segment level ring. */
export function PathNode({ level, locked, kind, current, size = 72, onClick, label }: { level: number; locked: boolean; kind: "theme" | "quotes"; current?: boolean; size?: number; onClick?: () => void; label: string }) {
  const ring = size + 22;
  const r = ring / 2 - 4;
  const segs = 5;
  const gap = 0.09;
  const arcs = Array.from({ length: segs }, (_, i) => {
    const a0 = (i / segs) * Math.PI * 2 - Math.PI / 2 + gap;
    const a1 = ((i + 1) / segs) * Math.PI * 2 - Math.PI / 2 - gap;
    const p = (a: number) => `${(ring / 2 + r * Math.cos(a)).toFixed(2)} ${(ring / 2 + r * Math.sin(a)).toFixed(2)}`;
    return { d: `M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`, on: i < level };
  });
  const done = level >= 5;
  const fill = locked ? "var(--shelf)" : done ? "var(--yellow)" : kind === "quotes" ? "var(--ink)" : "var(--blue)";
  const lip = locked ? "var(--line)" : done ? "var(--yellow-lip)" : kind === "quotes" ? "var(--ink-lip)" : "var(--blue-lip)";
  const fg = locked ? "var(--muted)" : done ? "#141414" : kind === "quotes" ? "var(--paper)" : "#fff";
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="group relative flex items-center justify-center"
      style={{ width: ring, height: ring + 6 }}
    >
      <svg width={ring} height={ring} className="absolute left-0 top-0" aria-hidden>
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill="none" strokeWidth={6} strokeLinecap="round" stroke={a.on ? "var(--yellow)" : "var(--line)"} />
        ))}
      </svg>
      <span
        className="relative flex items-center justify-center rounded-full transition-transform duration-150 ease-out group-active:translate-y-[6px]"
        style={{ width: size, height: size, background: fill, color: fg, boxShadow: `0 6px 0 ${lip}`, marginTop: -6 }}
      >
        {kind === "quotes" ? (
          <Quote size={30} strokeWidth={2.75} fill="currentColor" />
        ) : (
          <span className="text-[26px] font-black leading-none">{locked ? <LockGlyph /> : done ? "5" : <BookGlyph />}</span>
        )}
      </span>
      {current && !locked && <span className="sr-only">Current lesson</span>}
    </button>
  );
}

function BookGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 7v13" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="16" height="11" x="4" y="11" rx="2.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export const ZIGZAG = [0, 60, 90, 60, 0, -60, -90, -60];

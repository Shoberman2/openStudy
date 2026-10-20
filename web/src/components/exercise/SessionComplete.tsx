"use client";

import { Clock, Flame, Gem, Target } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Ring } from "@/components/ui/basics";

function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const dur = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : ms;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function SessionComplete({
  title,
  xp,
  accuracy,
  seconds,
  streak,
  goal,
  level,
  onContinue,
}: {
  title: string;
  xp: number;
  accuracy: number;
  seconds: number;
  streak: number;
  goal: { today: number; target: number };
  level?: number;
  onContinue: () => void;
}) {
  const shown = useCountUp(xp);
  const [ring, setRing] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setRing(Math.min(1, goal.today / goal.target)), 120);
    return () => clearTimeout(t);
  }, [goal.today, goal.target]);
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="anim-fade mx-auto flex w-full max-w-[640px] flex-1 flex-col items-center px-4 pb-40 pt-14 text-center sm:pt-20">
        <Ring value={ring} size={132} stroke={14}>
          <div>
            <div className="text-[34px] font-black leading-none text-[var(--yellow-lip)]">+{shown}</div>
            <div className="mt-1 text-[13px] font-extrabold text-muted">XP</div>
          </div>
        </Ring>
        <h1 className="mt-7 text-[30px] font-black leading-tight tracking-tight">{title}</h1>
        {level !== undefined && <p className="mt-1 font-bold text-muted">Level {level} of 5</p>}
        <div className="mt-8 grid w-full max-w-[460px] grid-cols-2 gap-3">
          <Stat icon={<Gem size={20} strokeWidth={2.5} />} tone="blue" label="XP earned" value={`${xp}`} />
          <Stat icon={<Target size={20} strokeWidth={2.5} />} tone="green" label="Accuracy" value={`${Math.round(accuracy * 100)}%`} />
          <Stat icon={<Clock size={20} strokeWidth={2.5} />} tone="ink" label="Time" value={`${mm}:${ss}`} />
          <Stat icon={<Flame size={20} strokeWidth={2.5} fill="var(--yellow)" />} tone="yellow" label="Streak" value={`${streak} day${streak === 1 ? "" : "s"}`} />
        </div>
        <p className="mt-6 text-[15px] font-bold text-muted">
          {Math.min(goal.today, goal.target)} of {goal.target} XP toward today&apos;s goal
        </p>
      </main>
      <div className="fixed inset-x-0 bottom-0 border-t-2 border-line bg-paper">
        <div className="mx-auto flex w-full max-w-[640px] justify-end px-4 py-4 sm:py-6">
          <button autoFocus className="btn w-full sm:w-auto sm:min-w-[180px]" onClick={onContinue}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "blue" | "green" | "yellow" | "ink" }) {
  const color = tone === "ink" ? "var(--ink)" : tone === "yellow" ? "var(--yellow-lip)" : `var(--${tone})`;
  return (
    <div className="rounded-[16px] border-2 border-line p-4 text-left" style={{ boxShadow: "0 3px 0 var(--line)" }}>
      <div className="flex items-center gap-1.5 text-[13px] font-extrabold" style={{ color }}>
        {icon}
        {label}
      </div>
      <div className="mt-1 text-[24px] font-black">{value}</div>
    </div>
  );
}

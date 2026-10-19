"use client";

import { ArrowLeft, Settings } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { displayStreak, goalProgress } from "@/engine/xp";
import { localDay } from "@/engine/util";
import { useLibrary } from "@/lib/store";
import { Logo, Ring, StreakPill, XpPill } from "@/components/ui/basics";

export function AppHeader() {
  const { lib } = useLibrary();
  const now = new Date();
  const today = lib.stats.dayXP[localDay(now)] ?? 0;
  return (
    <header className="sticky top-0 z-20 border-b-2 border-line bg-paper">
      <div className="mx-auto flex h-16 w-full max-w-[640px] items-center justify-between gap-3 px-4">
        <Logo href="/app" />
        <div className="flex items-center gap-4 text-[16px] sm:gap-5">
          <StreakPill streak={displayStreak(lib.stats, now)} />
          <span className="hidden min-[380px]:block">
            <XpPill xp={lib.stats.xp} />
          </span>
          <span title={`${today} of ${lib.profile.dailyGoalXP} XP today`} aria-label={`Daily goal ${today} of ${lib.profile.dailyGoalXP} XP`}>
            <Ring value={goalProgress(lib.stats, lib.profile.dailyGoalXP, now)} size={34} stroke={5} />
          </span>
          <Link href="/app/settings" aria-label="Settings" className="-mr-1 rounded-full p-1.5 text-muted hover:bg-shelf">
            <Settings size={22} strokeWidth={2.5} />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function BackHeader({ href, title, right }: { href: string; title?: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b-2 border-line bg-paper">
      <div className="mx-auto flex h-16 w-full max-w-[640px] items-center gap-3 px-4">
        <Link href={href} aria-label="Back" className="-ml-1.5 rounded-full p-1.5 text-muted hover:bg-shelf">
          <ArrowLeft size={24} strokeWidth={2.75} />
        </Link>
        <h1 className="flex-1 truncate text-[18px] font-extrabold">{title}</h1>
        {right}
      </div>
    </header>
  );
}

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <main className={`mx-auto w-full ${wide ? "max-w-[900px]" : "max-w-[640px]"} px-4 pb-24 pt-6`}>{children}</main>;
}

export function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
      <div className="h-3 w-40 overflow-hidden rounded-full bg-shelf">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-line" />
      </div>
    </div>
  );
}

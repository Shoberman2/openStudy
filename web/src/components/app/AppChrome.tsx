"use client";

import { ArrowLeft, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { avatarInitial } from "@/engine/profile";
import { useLibrary } from "@/lib/store";
import { Logo } from "@/components/ui/basics";

export function AppHeader() {
  const { lib } = useLibrary();
  const initial = avatarInitial(lib.profile.name);
  return (
    <header className="sticky top-0 z-20 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-[640px] items-center justify-between gap-3 px-4">
        <Logo href="/app" />
        <div className="flex items-center gap-2">
          <Link href="/app/settings" aria-label="Settings" className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-shelf">
            <Settings size={22} strokeWidth={2.25} />
          </Link>
          <Link href="/app/profile" aria-label="Profile" className="flex h-11 w-11 items-center justify-center rounded-full bg-shelf text-[16px] font-black text-ink hover:bg-line">
            {initial ?? <UserRound size={20} strokeWidth={2.25} className="text-muted" />}
          </Link>
        </div>
      </div>
    </header>
  );
}

export function BackHeader({ href, title, right }: { href: string; title?: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 bg-paper/90 backdrop-blur">
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

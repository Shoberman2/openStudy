"use client";

import type { ReactNode } from "react";

export function OptionTile({ selected, onClick, icon, label, sub }: { selected: boolean; onClick: () => void; icon: ReactNode; label: string; sub?: string }) {
  return (
    <button className="tile" aria-pressed={selected} onClick={onClick}>
      <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-[12px] ${selected ? "bg-blue text-white" : "bg-shelf text-ink"}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block">{label}</span>
        {sub && <span className={`block text-[14px] font-semibold ${selected ? "opacity-80" : "text-muted"}`}>{sub}</span>}
      </span>
    </button>
  );
}

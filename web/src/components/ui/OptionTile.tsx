"use client";

import { Check } from "lucide-react";

/** One choice: words, an optional line under them, and a check when picked (no icon box). */
export function OptionTile({ selected, onClick, label, sub }: { selected: boolean; onClick: () => void; label: string; sub?: string }) {
  return (
    <button className="tile" aria-pressed={selected} onClick={onClick}>
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {sub && <span className={`block text-[15px] font-semibold ${selected ? "opacity-80" : "text-muted"}`}>{sub}</span>}
      </span>
      {selected && <Check size={20} strokeWidth={3} className="flex-none" aria-hidden />}
    </button>
  );
}

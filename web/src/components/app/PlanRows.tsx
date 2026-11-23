"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import type { PlanItem } from "@/engine/plan";
import type { Library } from "@/engine/types";

export function itemHref(item: PlanItem): string {
  if (item.kind === "review") return "/app/practice";
  if (item.kind === "test") return `/app/test/${item.projectId}`;
  return `/app/learn/${item.lessonId}`;
}

function label(item: PlanItem): { title: string; sub: string } {
  if (item.kind === "review") return { title: `Review ${item.cards} card${item.cards === 1 ? "" : "s"}`, sub: "Across all your study sets" };
  if (item.kind === "test") return { title: "Practice test", sub: item.projectTitle };
  if (item.weak) return { title: item.title, sub: `${item.projectTitle}, missed on your last test` };
  // A lesson named like its project (one file, first heading) would print the same line twice.
  return { title: item.title, sub: item.projectTitle.trim().toLowerCase() === item.title.trim().toLowerCase() ? "" : item.projectTitle };
}

export function PlanRow({ item, interactive = true }: { item: PlanItem; lib?: Library; interactive?: boolean }) {
  const { title, sub } = label(item);
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-2 truncate text-[17px] font-extrabold ${item.done ? "text-muted" : ""}`}>
          {item.done && <Check size={18} strokeWidth={3} className="flex-none text-green" aria-label="Done" />}
          <span className="truncate">{title}</span>
        </span>
        {sub && <span className="block truncate text-[15px] text-muted">{sub}</span>}
      </span>
      <span className="num flex-none text-[15px] font-bold text-muted">{item.minutes} min</span>
    </>
  );
  const cls = "flex items-center gap-3 rounded-[14px] px-3 py-2.5";
  if (!interactive || item.done) return <li className={cls}>{body}</li>;
  return (
    <li>
      <Link href={itemHref(item)} className={`${cls} no-underline hover:bg-shelf`}>
        {body}
      </Link>
    </li>
  );
}

export function FeasibilityNotice({ title, goalDate, minutes, onUse }: { title: string; goalDate: string; minutes: number; onUse: () => void }) {
  const [y, m, d] = goalDate.split("-").map(Number);
  const date = new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div className="flex flex-col gap-3 rounded-[16px] bg-yellow-soft p-4 sm:flex-row sm:items-center">
      <p className="flex-1 font-bold">
        To be ready for {title} by {date} you need about {minutes} min a day.
      </p>
      <button className="btn btn-sm btn-yellow flex-none" onClick={onUse}>
        Use {minutes} min
      </button>
    </div>
  );
}

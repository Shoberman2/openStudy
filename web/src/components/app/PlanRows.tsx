"use client";

import { BookOpen, Check, ClipboardCheck, Quote, RefreshCw } from "lucide-react";
import Link from "next/link";
import type { PlanItem } from "@/engine/plan";
import type { Library } from "@/engine/types";

export function itemHref(item: PlanItem): string {
  if (item.kind === "review") return "/app/practice";
  if (item.kind === "test") return `/app/test/${item.projectId}`;
  return `/app/learn/${item.lessonId}`;
}

function label(item: PlanItem): { title: string; sub: string } {
  if (item.kind === "review") return { title: `Review ${item.cards} card${item.cards === 1 ? "" : "s"}`, sub: "Spaced review across everything" };
  if (item.kind === "test") return { title: "Practice test", sub: item.projectTitle };
  return { title: item.title, sub: item.weak ? `${item.projectTitle}, missed on your last test` : item.projectTitle };
}

export function PlanRow({ item, lib, interactive = true }: { item: PlanItem; lib: Library; interactive?: boolean }) {
  const { title, sub } = label(item);
  const isQuotes = item.kind === "lesson" && lib.lessons.find((l) => l.id === item.lessonId)?.kind === "quotes";
  const Icon = item.kind === "review" ? RefreshCw : item.kind === "test" ? ClipboardCheck : isQuotes ? Quote : BookOpen;
  const tone = item.kind === "test" ? "bg-yellow-soft text-[var(--yellow-lip)]" : item.kind === "review" ? "bg-green-soft text-green" : "bg-blue-soft text-blue";
  const body = (
    <>
      <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-[12px] ${item.done ? "bg-green text-white" : tone}`}>
        {item.done ? <Check size={20} strokeWidth={3} /> : <Icon size={20} strokeWidth={2.5} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-extrabold ${item.done ? "text-muted line-through decoration-2" : ""}`}>{title}</span>
        <span className="block truncate text-[13px] font-semibold text-muted">{sub}</span>
      </span>
      <span className="flex-none text-[13px] font-extrabold text-muted">{item.minutes} min</span>
    </>
  );
  const cls = "flex items-center gap-3 rounded-[14px] px-2 py-2";
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
    <div className="flex flex-col gap-3 rounded-[16px] border-2 border-[var(--yellow-lip)] bg-yellow-soft p-4 sm:flex-row sm:items-center">
      <p className="flex-1 font-bold">
        To be ready for {title} by {date} you need about {minutes} min a day.
      </p>
      <button className="btn btn-sm btn-yellow flex-none" onClick={onUse}>
        Use {minutes} min
      </button>
    </div>
  );
}

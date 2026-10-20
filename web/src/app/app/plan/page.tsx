"use client";

import { Flag } from "lucide-react";
import Link from "next/link";
import { buildPlan, dayLabel } from "@/engine/plan";
import { useLibrary } from "@/lib/store";
import { BackHeader, Loading, Page } from "@/components/app/AppChrome";
import { FeasibilityNotice, PlanRow } from "@/components/app/PlanRows";

export default function PlanPage() {
  const { lib, ready, update } = useLibrary();
  if (!ready) return <Loading />;
  const now = new Date();
  const plan = buildPlan(lib, now);
  const titleOf = (id: string) => lib.projects.find((p) => p.id === id)?.title ?? "";

  return (
    <>
      <BackHeader href="/app" title="Your plan" />
      <Page>
        {!lib.projects.length ? (
          <div className="py-12 text-center">
            <h1 className="text-[24px] font-black">Nothing to plan yet</h1>
            <p className="mt-1 text-muted">Add something to learn and your study days show up here.</p>
            <Link href="/app/import" className="btn mt-6">
              Import material
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-[26px] font-black leading-tight tracking-tight">Your plan</h1>
            <p className="mt-1 text-muted">
              {plan.days[0].budget} min a day. Reviews come first, then new lessons, spaced out so they stick. Set an exam date on a project to plan up to it.
            </p>
            {plan.feasibility.length > 0 && (
              <div className="mt-5 grid grid-cols-1 gap-3">
                {plan.feasibility.map((f) => (
                  <FeasibilityNotice
                    key={f.projectId}
                    title={f.title}
                    goalDate={f.goalDate}
                    minutes={f.neededMinutes}
                    onUse={() => update((l) => ({ ...l, projects: l.projects.map((p) => (p.id === f.projectId ? { ...p, minutesPerDay: f.neededMinutes } : p)) }))}
                  />
                ))}
              </div>
            )}
            <ol className="mt-6 grid grid-cols-1 gap-4">
              {plan.days.map((d, i) => {
                const total = Math.round(d.items.reduce((s, x) => s + x.minutes, 0));
                return (
                  <li key={d.date} className="card p-4 sm:p-5" data-testid="plan-day">
                    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-2">
                      <h2 className="text-[18px] font-black">{dayLabel(d.date, now)}</h2>
                      <span className="text-[13px] font-extrabold text-muted">{total ? `About ${total} min` : "Rest day"}</span>
                    </div>
                    {d.goals.map((id) => (
                      <p key={id} className="mx-2 mb-2 mt-1 inline-flex items-center gap-1.5 rounded-[10px] bg-red-soft px-2.5 py-1 text-[13px] font-extrabold text-red">
                        <Flag size={14} strokeWidth={2.75} /> Exam: {titleOf(id)}
                      </p>
                    ))}
                    {d.items.length ? (
                      <ul className="grid grid-cols-1 gap-0.5">
                        {d.items.map((it, j) => (
                          <PlanRow key={j} item={it} lib={lib} interactive={i === 0} />
                        ))}
                      </ul>
                    ) : (
                      <p className="px-2 py-1 text-[14px] text-muted">Nothing scheduled.</p>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </Page>
    </>
  );
}

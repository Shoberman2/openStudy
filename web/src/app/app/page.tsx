"use client";

// Home (spec 17.2): today's queue on top, one action to start it, then the study sets as plain rows.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { currentLesson, inboxPages, projectLessons } from "@/engine/library";
import { buildPlan } from "@/engine/plan";
import { useLibrary } from "@/lib/store";
import { AppHeader, Loading, Page } from "@/components/app/AppChrome";
import { FeasibilityNotice, PlanRow, itemHref } from "@/components/app/PlanRows";

const shortDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export default function Home() {
  const { lib, ready, update } = useLibrary();
  const router = useRouter();

  useEffect(() => {
    if (ready && !lib.profile.onboarded) router.replace("/app/welcome");
  }, [ready, lib.profile.onboarded, router]);

  if (!ready || !lib.profile.onboarded) return <Loading />;

  const now = new Date();
  const inbox = inboxPages(lib).length;
  const projects = lib.projects.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const plan = projects.length ? buildPlan(lib, now) : null;
  const today = plan?.days[0];
  const open = today?.items.filter((it) => !it.done) ?? [];
  const planned = Math.round(today?.items.reduce((s, x) => s + x.minutes, 0) ?? 0);
  const over = Math.round(today?.overBy ?? 0);

  return (
    <>
      <AppHeader />
      <Page>
        {inbox > 0 && (
          <Link href="/app/sort" className="mb-8 flex items-center gap-4 rounded-[16px] bg-shelf p-4 no-underline hover:bg-[var(--line)]">
            <span className="flex-1 font-extrabold">
              {inbox} page{inbox === 1 ? "" : "s"} to sort
            </span>
            <span className="text-[16px] font-extrabold text-blue">Sort</span>
          </Link>
        )}

        {today && today.items.length > 0 ? (
          <section aria-label="Today">
            <h1 className="text-[32px] font-black leading-tight tracking-tight">Today</h1>
            <p className="mt-1 text-[16px] text-muted">
              About {planned} min of your {today.budget} min
              {over > 0 ? `. Over by ${over} min to stay on track for your exam.` : "."}
            </p>
            <ul className="mt-4 grid grid-cols-1 gap-1">
              {today.items.map((it, i) => (
                <PlanRow key={i} item={it} lib={lib} />
              ))}
            </ul>
            {open.length > 0 ? (
              <Link href={itemHref(open[0])} className="btn btn-block mt-5">
                Start today&apos;s practice
              </Link>
            ) : (
              <p className="mt-5 font-extrabold text-green">Done for today.</p>
            )}
            <Link href="/app/plan" className="mt-3 block text-center text-[16px] font-bold text-muted hover:text-ink">
              See the week
            </Link>
          </section>
        ) : projects.length === 0 ? (
          <section className="pt-6 text-center" aria-label="Get started">
            <h1 className="text-[32px] font-black leading-tight tracking-tight">Add Your Notes</h1>
            <p className="mx-auto mt-2 max-w-[420px] text-[17px] text-muted">Class notes, slides, PDFs or a photo of the whiteboard. You will be answering questions in a minute.</p>
            <Link href="/app/import" className="btn btn-block mx-auto mt-6 max-w-[360px]">
              Add notes
            </Link>
          </section>
        ) : null}

        {plan?.feasibility.map((f) => (
          <div key={f.projectId} className="mt-6">
            <FeasibilityNotice
              title={f.title}
              goalDate={f.goalDate}
              minutes={f.neededMinutes}
              onUse={() => update((l) => ({ ...l, projects: l.projects.map((p) => (p.id === f.projectId ? { ...p, minutesPerDay: f.neededMinutes } : p)) }))}
            />
          </div>
        ))}

        {projects.length > 0 && (
          <section className="mt-12" aria-label="Study sets">
            <h2 className="text-[22px] font-black">Study sets</h2>
            <ul className="mt-3 grid grid-cols-1 gap-1">
              {projects.map((p) => {
                const lessons = projectLessons(lib, p.id);
                const next = currentLesson(lessons);
                const meta = [
                  `${lessons.length} topic${lessons.length === 1 ? "" : "s"}`,
                  p.goalDate ? `Exam ${shortDate(p.goalDate)}` : null,
                  next ? `Next up: ${next.title}` : null,
                ].filter(Boolean);
                return (
                  <li key={p.id}>
                    <Link href={`/app/p/${p.id}`} className="block rounded-[14px] px-3 py-3 no-underline hover:bg-shelf">
                      <span className="block truncate text-[18px] font-extrabold">{p.title}</span>
                      <span className="block truncate text-[15px] text-muted">{meta.join(" · ")}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Link href="/app/import" className="mt-3 inline-block px-3 text-[16px] font-extrabold text-blue hover:underline">
              Add notes
            </Link>
          </section>
        )}
      </Page>
    </>
  );
}

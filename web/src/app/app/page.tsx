"use client";

import { Inbox, Link2, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { joinAnd, libraryConnections } from "@/engine/connections";
import { continueTarget, inboxPages, logEvent, projectLessons } from "@/engine/library";
import { isDue } from "@/engine/srs";
import { nextDueDate } from "@/engine/session";
import { localDay, relativeTime } from "@/engine/util";
import { goalProgress } from "@/engine/xp";
import { withSample } from "@/lib/actions";
import { useLibrary } from "@/lib/store";
import { AppHeader, Loading, Page } from "@/components/app/AppChrome";
import { AskBox } from "@/components/app/AskBox";
import { FeasibilityNotice, PlanRow } from "@/components/app/PlanRows";
import { buildPlan } from "@/engine/plan";
import { BookSpine, ProgressBar, Ring } from "@/components/ui/basics";

export default function Home() {
  const { lib, ready, update } = useLibrary();
  const router = useRouter();

  useEffect(() => {
    if (ready && !lib.profile.onboarded) router.replace("/app/welcome");
  }, [ready, lib.profile.onboarded, router]);

  if (!ready || !lib.profile.onboarded) return <Loading />;

  const now = new Date();
  const target = continueTarget(lib);
  const due = lib.cards.filter((c) => isDue(c.srs, now)).length;
  const next = nextDueDate(lib.cards);
  const inbox = inboxPages(lib).length;
  const todayXP = lib.stats.dayXP[localDay(now)] ?? 0;
  const goal = lib.profile.dailyGoalXP;
  const projects = lib.projects.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const plan = lib.projects.length ? buildPlan(lib, now) : null;
  const today = plan?.days[0];
  const connections = libraryConnections(lib.projects, lib.lessons, lib.cards);
  const real = lib.projects.filter((p) => !p.sample).map((p) => p.id);
  // Ask my notes: every project page, the sample only when it is all there is.
  const askPages = lib.pages.filter((p) => p.projectId && (real.length ? real.includes(p.projectId) : true));
  const title = (id: string) => lib.projects.find((p) => p.id === id)?.title ?? "";
  const lessonTitle = (id: string) => lib.lessons.find((l) => l.id === id)?.title ?? "";

  return (
    <>
      <AppHeader />
      <Page>
        {inbox > 0 && (
          <Link href="/app/sort" className="card mb-5 flex items-center gap-3 p-4 no-underline hover:border-[var(--line-strong)]">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] bg-yellow-soft text-[var(--yellow-lip)]">
              <Inbox size={22} strokeWidth={2.5} />
            </span>
            <span className="flex-1">
              <span className="block font-extrabold">
                {inbox} page{inbox === 1 ? "" : "s"} waiting to be sorted
              </span>
              <span className="block text-[14px] text-muted">Confirm which book they belong to.</span>
            </span>
            <span className="btn btn-sm btn-yellow">Sort</span>
          </Link>
        )}

        {plan && today && today.items.length > 0 && (
          <section className="card mb-5 p-4 sm:p-5" aria-label="Today's plan">
            <div className="mb-2 flex items-baseline justify-between gap-3 px-2">
              <h2 className="text-[20px] font-black">Today&apos;s plan</h2>
              <Link href="/app/plan" className="text-[14px] font-extrabold text-blue hover:underline">
                See your plan
              </Link>
            </div>
            <ul className="grid grid-cols-1 gap-0.5">
              {today.items.slice(0, 5).map((it, i) => (
                <PlanRow key={i} item={it} lib={lib} />
              ))}
            </ul>
            <p className="mt-2 px-2 text-[13px] font-bold text-muted">
              About {Math.round(today.items.reduce((s, x) => s + x.minutes, 0))} min of {today.budget} min today
              {today.items.length > 5 ? `, ${today.items.length - 5} more on the plan` : ""}
            </p>
          </section>
        )}
        {plan?.feasibility.map((f) => (
          <div key={f.projectId} className="mb-5">
            <FeasibilityNotice
              title={f.title}
              goalDate={f.goalDate}
              minutes={f.neededMinutes}
              onUse={() => update((l) => ({ ...l, projects: l.projects.map((p) => (p.id === f.projectId ? { ...p, minutesPerDay: f.neededMinutes } : p)) }))}
            />
          </div>
        ))}

        {target ? (
          <section className="card overflow-hidden">
            <div className="p-5 sm:p-6">
              <p className="kicker truncate">{target.project.title}</p>
              <h2 className="mt-1 text-[26px] font-black leading-tight tracking-tight">{target.lesson.title}</h2>
              <p className="mt-1.5 text-muted">{target.lesson.summary}</p>
              <div className="mt-4 flex items-center gap-3">
                <div className="flex-1">
                  <ProgressBar value={target.lesson.level / 5} label="Lesson level" />
                </div>
                <span className="text-[14px] font-extrabold text-muted">Level {target.lesson.level} of 5</span>
              </div>
            </div>
            <div className="grid gap-3 border-t-2 border-line bg-shelf p-4 sm:grid-cols-2 sm:p-5">
              <Link href={`/app/learn/${target.lesson.id}`} className="btn btn-block">
                {target.lesson.sessions === 0 ? "Start" : "Continue"}
              </Link>
              <Link href={`/app/p/${target.project.id}`} className="btn btn-secondary btn-block">
                Open path
              </Link>
            </div>
          </section>
        ) : (
          <section className="card p-6 text-center">
            <h2 className="text-[24px] font-black">Add your first book</h2>
            <p className="mt-1 text-muted">Drop in screenshots or paste excerpts from Notes.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Link href="/app/import" className="btn btn-block">
                Import pages
              </Link>
              <button className="btn btn-secondary btn-block" onClick={() => update(withSample)}>
                Try a sample book
              </button>
            </div>
          </section>
        )}

        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="card flex items-center gap-4 p-5">
            <Ring value={goalProgress(lib.stats, goal, now)} size={58} stroke={8}>
              <span className="text-[13px] font-black">{Math.min(100, Math.round((todayXP / goal) * 100))}%</span>
            </Ring>
            <div>
              <p className="font-extrabold">Daily goal</p>
              <p className="text-[15px] text-muted">
                {todayXP} of {goal} XP today
              </p>
            </div>
          </div>
          <div className="card flex items-center gap-4 p-5">
            <span className="flex h-[58px] w-[58px] flex-none items-center justify-center rounded-full bg-blue-soft text-blue">
              <RefreshCw size={26} strokeWidth={2.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold">Practice</p>
              <p className="text-[15px] text-muted">
                {due > 0 ? `${due} card${due === 1 ? "" : "s"} due` : next ? `Next review ${relativeTime(next, now)}` : "None due"}
              </p>
            </div>
            <Link href="/app/practice" className={`btn btn-sm ${due > 0 ? "" : "btn-secondary"}`}>
              Practice
            </Link>
          </div>
        </section>

        {askPages.length > 0 && (
          <div className="mt-5">
            <AskBox lib={lib} pages={askPages} scope="all" label="Ask my notes" update={update} />
          </div>
        )}

        {connections.length > 0 && (
          <section className="card mt-5 p-4 sm:p-5" aria-label="Connections" data-testid="connections">
            <h2 className="px-1 text-[20px] font-black">Connections</h2>
            <ul className="mt-2 grid gap-3">
              {connections.map((c) => (
                <li key={c.lessons.join("|")} className="flex flex-wrap items-center gap-3 rounded-[14px] bg-shelf p-3">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[12px] bg-paper text-blue">
                    <Link2 size={20} strokeWidth={2.5} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold leading-snug">
                      {title(c.projects[0])} and {title(c.projects[1])} both cover {joinAnd(c.terms)}.
                    </p>
                    <p className="truncate text-[13px] font-bold text-muted">
                      {lessonTitle(c.lessons[0])} · {lessonTitle(c.lessons[1])}
                    </p>
                  </div>
                  <Link
                    href={`/app/practice?a=${c.lessons[0]}&b=${c.lessons[1]}`}
                    className="btn btn-sm btn-secondary flex-none"
                    onClick={() => update((l) => logEvent(l, "connection_practice", {}))}
                  >
                    Practice both
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-9">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[22px] font-black">Your shelf</h2>
            <span className="text-[14px] font-bold text-muted">
              {projects.length} project{projects.length === 1 ? "" : "s"}
            </span>
          </div>
          {(() => {
            // Category clusters side by side, wrapping onto more shelves (spec 9.7).
            const groups = new Map<string, typeof projects>();
            for (const p of projects) {
              const c = p.category?.trim() || "General";
              groups.set(c, [...(groups.get(c) ?? []), p]);
            }
            const spine = (p: (typeof projects)[number], i: number) => (
              <div key={p.id} className="flex flex-col items-center">
                <BookSpine project={p} href={`/app/p/${p.id}`} height={200 + ((i * 37) % 3) * 12} />
                <span className="sr-only">{projectLessons(lib, p.id).length} {projectLessons(lib, p.id).length === 1 ? "lesson" : "lessons"}</span>
              </div>
            );
            const add = (
              <Link href="/app/import" className="spine spine-add" style={{ height: 200 }} aria-label="Import pages">
                <Plus size={26} strokeWidth={2.75} />
              </Link>
            );
            if (groups.size < 2)
              return (
                <div className="no-scrollbar -mx-4 overflow-x-auto px-4">
                  <div className="inline-flex min-w-full flex-col">
                    <div className="flex items-end gap-2.5 px-3 pt-3">
                      {projects.map(spine)}
                      {add}
                    </div>
                    <div className="shelf-board" />
                  </div>
                </div>
              );
            const clusters = [...groups].sort(([a], [b]) => a.localeCompare(b));
            return (
              <div className="flex flex-wrap items-end gap-y-6">
                {clusters.map(([category, list], ci) => (
                  <div key={category} className="flex min-w-0 grow flex-col" data-testid="shelf-row">
                    <p className="truncate px-3 text-[13px] font-bold text-muted">
                      {category} <span className="font-semibold">({list.length})</span>
                    </p>
                    <div className="flex items-end gap-2.5 px-3 pt-2">
                      {list.map(spine)}
                      {ci === clusters.length - 1 && add}
                    </div>
                    <div className="shelf-board" />
                  </div>
                ))}
              </div>
            );
          })()}
        </section>
      </Page>
    </>
  );
}

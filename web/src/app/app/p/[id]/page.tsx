"use client";

import { ArrowRightLeft, CalendarDays, ClipboardCheck, Lock, Quote, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { buildProject } from "@/engine/classbuilder";
import { currentLesson, extendProject, projectLessons, unlockedIds } from "@/engine/library";
import { newSrs } from "@/engine/srs";
import { normalizeForDedupe, splitSentences, wordCount } from "@/engine/text";
import type { Lesson, Library, Page as LibPage } from "@/engine/types";
import { newId } from "@/engine/util";
import { toBuildPages } from "@/lib/actions";
import { deleteImage } from "@/lib/images";
import { useLibrary } from "@/lib/store";
import { BackHeader, Loading, Page } from "@/components/app/AppChrome";
import { PageThumb } from "@/components/app/PageThumb";
import { BookSpine, PathNode, ProgressBar, Sheet, ZIGZAG } from "@/components/ui/basics";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { lib, ready, update } = useLibrary();
  const router = useRouter();
  const [tab, setTab] = useState<"path" | "pages">("path");
  const [open, setOpen] = useState<Lesson | null>(null);

  if (!ready) return <Loading />;
  const project = lib.projects.find((p) => p.id === id);
  if (!project)
    return (
      <>
        <BackHeader href="/app" title="Not found" />
        <Page>
          <p className="py-10 text-center text-muted">This book is not on your shelf.</p>
        </Page>
      </>
    );

  const lessons = projectLessons(lib, project.id);
  const unlocked = unlockedIds(lessons);
  const cur = currentLesson(lessons);
  const pages = lib.pages.filter((p) => p.projectId === project.id);
  const readyCount = lessons.filter((l) => l.level >= 3).length;
  const cardCount = (lid: string) => lib.cards.filter((c) => c.lessonId === lid).length;
  const prevTheme = (l: Lesson) => lessons.filter((x) => x.kind === "theme" && x.order < l.order).slice(-1)[0];

  return (
    <>
      <BackHeader href="/app" title={project.title} />
      <Page>
        <section className="flex items-center gap-5">
          <BookSpine project={project} height={132} />
          <div className="min-w-0">
            <h1 className="text-[26px] font-black leading-tight tracking-tight sm:text-[30px]">{project.title}</h1>
            {project.author && <p className="mt-0.5 font-bold text-muted">{project.author}</p>}
            <p className="mt-2 text-[14px] font-bold text-muted">
              {pages.length} page{pages.length === 1 ? "" : "s"}, {lessons.length} lesson{lessons.length === 1 ? "" : "s"}
            </p>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-3 rounded-[16px] border-2 border-line p-3">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[12px] bg-red-soft text-red">
              <CalendarDays size={20} strokeWidth={2.5} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-extrabold text-muted">Exam or finish-by date</span>
              <input
                type="date"
                value={project.goalDate ?? ""}
                aria-label="Goal date"
                data-testid="goal-date"
                onChange={(e) => update((l) => ({ ...l, projects: l.projects.map((x) => (x.id === project.id ? { ...x, goalDate: e.target.value || undefined } : x)) }))}
                className="w-full min-w-0 bg-transparent text-[16px] font-extrabold text-ink outline-none"
              />
            </span>
          </label>
          <div className="flex items-center gap-3 rounded-[16px] border-2 border-line p-3">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[12px] bg-yellow-soft text-[var(--yellow-lip)]">
              <ClipboardCheck size={20} strokeWidth={2.5} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-extrabold text-muted">Practice test</span>
              <span className="block truncate text-[14px] font-bold">{readyCount >= 2 ? "Scores every lesson" : `Opens when 2 lessons reach level 3 (${readyCount} now)`}</span>
            </span>
            {readyCount >= 2 ? (
              <Link href={`/app/test/${project.id}`} className="btn btn-sm btn-yellow flex-none" data-testid="practice-test">
                Start
              </Link>
            ) : null}
          </div>
        </section>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-extrabold text-muted">This is a</span>
          <div className="flex gap-1 rounded-[12px] bg-shelf p-1" role="radiogroup" aria-label="Project type">
            {(
              [
                ["book", "Book"],
                ["class", "Class"],
                ["other", "Other"],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                role="radio"
                aria-checked={(project.type ?? "book") === t}
                onClick={() => update((l) => ({ ...l, projects: l.projects.map((x) => (x.id === project.id ? { ...x, type: t } : x)) }))}
                className={`h-8 rounded-[9px] px-3 text-[14px] font-extrabold ${(project.type ?? "book") === t ? "bg-paper text-ink shadow-[0_2px_0_var(--line)]" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 rounded-[16px] bg-shelf p-1.5" role="tablist">
          {(["path", "pages"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`h-11 rounded-[12px] font-extrabold transition-colors ${tab === t ? "bg-paper text-ink shadow-[0_2px_0_var(--line)]" : "text-muted"}`}
            >
              {t === "path" ? "Path" : "Pages"}
            </button>
          ))}
        </div>

        {tab === "path" ? (
          <section className="relative mx-auto mt-16 flex max-w-[360px] flex-col items-center gap-9 pb-10" aria-label="Lesson path">
            {lessons.map((l, i) => {
              const locked = !unlocked.has(l.id);
              const isCur = cur?.id === l.id;
              return (
                <div key={l.id} className="relative flex flex-col items-center" style={{ transform: `translateX(${ZIGZAG[i % ZIGZAG.length]}px)` }}>
                  {isCur && (
                    <div className="anim-fade absolute -top-12 z-10 rounded-[12px] border-2 border-line bg-paper px-3.5 py-1.5 text-[15px] font-black text-blue shadow-[0_3px_0_var(--line)]">
                      Start
                      <span className="absolute -bottom-[8px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-line bg-paper" />
                    </div>
                  )}
                  <PathNode level={l.level} locked={locked} kind={l.kind} current={isCur} label={`${l.title}, level ${l.level} of 5${locked ? ", locked" : ""}`} onClick={() => setOpen(l)} />
                  <p className={`mt-2 max-w-[150px] text-center text-[14px] font-extrabold leading-tight ${locked ? "text-muted" : ""}`}>{l.title}</p>
                </div>
              );
            })}
            {!lessons.length && <p className="text-muted">No lessons yet. Add more pages to this book.</p>}
          </section>
        ) : (
          <PagesTab lib={lib} projectId={project.id} pages={pages} update={update} onMoved={(pid) => router.push(`/app/p/${pid}`)} />
        )}
      </Page>

      <Sheet open={!!open} onClose={() => setOpen(null)} label="Lesson">
        {open && (
          <div>
            <p className="kicker">{open.kind === "quotes" ? "Quotes lesson" : "Theme"}</p>
            <h3 className="mt-1 pr-8 text-[24px] font-black leading-tight">{open.title}</h3>
            <p className="mt-2 text-muted">{open.summary}</p>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1">
                <ProgressBar value={open.level / 5} color="yellow" label="Level" />
              </div>
              <span className="text-[14px] font-extrabold text-muted">Level {open.level} of 5</span>
            </div>
            <p className="mt-2 text-[14px] font-bold text-muted">
              {cardCount(open.id)} {open.kind === "quotes" ? "quotes" : "cards"}, {open.sessions} session{open.sessions === 1 ? "" : "s"} done
            </p>
            {unlocked.has(open.id) ? (
              <Link href={`/app/learn/${open.id}`} className="btn btn-block mt-6">
                {open.sessions === 0 ? "Start" : open.level >= 5 ? "Practice again" : "Continue"}
              </Link>
            ) : (
              <div className="mt-6 flex items-center gap-2.5 rounded-[14px] bg-shelf p-4 font-bold text-muted">
                <Lock size={20} strokeWidth={2.5} /> Finish {prevTheme(open)?.title ?? "the previous lesson"} once to unlock.
              </div>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}

function ensureQuotesLesson(lib: Library, projectId: string): { lib: Library; lessonId: string } {
  const lessons = projectLessons(lib, projectId);
  const existing = lessons.find((l) => l.kind === "quotes");
  if (existing) return { lib, lessonId: existing.id };
  const lessonId = newId();
  const firstTheme = lessons.find((l) => l.kind === "theme");
  const insertAt = firstTheme ? firstTheme.order + 1 : 0;
  const reordered = lib.lessons.map((l) => (l.projectId === projectId && l.order >= insertAt ? { ...l, order: l.order + 1 } : l));
  const lesson: Lesson = { id: lessonId, projectId, title: "Quotes", summary: "The lines worth knowing word for word.", kind: "quotes", order: insertAt, level: 0, sessions: 0 };
  return { lib: { ...lib, lessons: [...reordered, lesson], projects: lib.projects.map((p) => (p.id === projectId ? { ...p, quotesAsked: true, focus: "ideas+quotes" } : p)) }, lessonId };
}

function removePageCards(lib: Library, pageId: string): Library {
  const cards = lib.cards.filter((c) => c.pageId !== pageId);
  const used = new Set(cards.map((c) => c.lessonId));
  return { ...lib, cards, lessons: lib.lessons.filter((l) => used.has(l.id) || l.kind === "quotes") };
}

function PagesTab({ lib, projectId, pages, update, onMoved }: { lib: Library; projectId: string; pages: LibPage[]; update: (fn: (l: Library) => Library) => void; onMoved: (pid: string) => void }) {
  const [quotePage, setQuotePage] = useState<LibPage | null>(null);
  const [movePage, setMovePage] = useState<LibPage | null>(null);
  const project = lib.projects.find((p) => p.id === projectId)!;
  const quoteKeys = new Set(lib.cards.filter((c) => c.projectId === projectId && c.kind === "quote").map((c) => normalizeForDedupe(c.statement)));

  const markQuote = (page: LibPage, text: string) => {
    update((l) => {
      const r = ensureQuotesLesson(l, projectId);
      return {
        ...r.lib,
        cards: [...r.lib.cards, { id: newId(), lessonId: r.lessonId, projectId, pageId: page.id, kind: "quote", statement: text, attribution: project.author, srs: newSrs() }],
      };
    });
  };

  return (
    <section className="mt-6 grid grid-cols-1 gap-3">
      {pages.map((p) => (
        <article key={p.id} className="card flex gap-4 p-3.5">
          <div className="w-[72px] flex-none">
            <PageThumb page={p} />
          </div>
          <div className="min-w-0 flex-1">
            {(p.heading ?? p.header) && <p className="kicker truncate">{p.heading ?? p.header}</p>}
            {p.sourceName && <p className="truncate text-[12px] font-bold text-muted">{p.sourceIndex ? `${p.sourceName}, ${p.kind === "slides" ? "slide" : "page"} ${p.sourceIndex}` : p.sourceName}</p>}
            <p className="serif mt-0.5 line-clamp-4 text-[16px] leading-snug">{p.text}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-sm btn-secondary" onClick={() => setQuotePage(p)}>
                <Quote size={16} strokeWidth={2.5} /> Mark as quote
              </button>
              {lib.projects.length > 1 && (
                <button className="btn btn-sm btn-secondary" onClick={() => setMovePage(p)} aria-label="Move page">
                  <ArrowRightLeft size={16} strokeWidth={2.5} /> Move
                </button>
              )}
              <button
                className="btn btn-sm btn-secondary !text-red"
                aria-label="Delete page"
                onClick={() => {
                  if (!confirm("Delete this page and its cards?")) return;
                  if (p.image) void deleteImage(p.image);
                  update((l) => removePageCards({ ...l, pages: l.pages.filter((x) => x.id !== p.id) }, p.id));
                }}
              >
                <Trash2 size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </article>
      ))}
      {!pages.length && <p className="py-8 text-center text-muted">No source pages.</p>}

      <Sheet open={!!quotePage} onClose={() => setQuotePage(null)} label="Mark as quote">
        {quotePage && (
          <>
            <h3 className="pr-8 text-[22px] font-black">Pick the lines to learn word for word</h3>
            <div className="mt-4 grid grid-cols-1 gap-2">
              {[...(wordCount(quotePage.text) <= 60 ? [quotePage.text] : []), ...splitSentences(quotePage.text).filter((s) => wordCount(s) >= 4)]
                .filter((s, i, a) => a.indexOf(s) === i)
                .map((s) => {
                  const added = quoteKeys.has(normalizeForDedupe(s));
                  return (
                    <button key={s} disabled={added} className={`tile !font-medium serif !text-[16px] ${added ? "is-correct" : ""}`} onClick={() => markQuote(quotePage, s)}>
                      {s}
                    </button>
                  );
                })}
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={!!movePage} onClose={() => setMovePage(null)} label="Move page">
        {movePage && (
          <>
            <h3 className="pr-8 text-[22px] font-black">Move to another book</h3>
            <div className="mt-4 grid grid-cols-1 gap-2.5">
              {lib.projects
                .filter((p) => p.id !== projectId)
                .map((p) => (
                  <button
                    key={p.id}
                    className="tile"
                    onClick={() => {
                      update((l) => {
                        const stripped = removePageCards(l, movePage.id);
                        const result = buildProject({ title: p.title, author: p.author, type: p.type }, toBuildPages([movePage]));
                        return extendProject(stripped, p.id, [movePage.id], result, []);
                      });
                      setMovePage(null);
                      onMoved(p.id);
                    }}
                  >
                    {p.title}
                  </button>
                ))}
            </div>
          </>
        )}
      </Sheet>
    </section>
  );
}

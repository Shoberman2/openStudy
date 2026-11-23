"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { buildProject } from "@/engine/classbuilder";
import { isCode } from "@/engine/code";
import { currentLesson, defineWord, extendProject, logEvent, projectLessons, setFocus, wordsToDefine } from "@/engine/library";
import { PRACTICE_TEST_READY_LESSONS, READY_LEVEL, readyLessonCount } from "@/engine/plan";
import { newSrs } from "@/engine/srs";
import { normalizeForDedupe, splitSentences, truncate, wordCount } from "@/engine/text";
import type { Lesson, Library, Page as LibPage, Project } from "@/engine/types";
import { newId } from "@/engine/util";
import { toBuildPages } from "@/lib/actions";
import { deleteImage } from "@/lib/images";
import { useLibrary } from "@/lib/store";
import { BackHeader, Loading, Page } from "@/components/app/AppChrome";
import { AskBox } from "@/components/app/AskBox";
import { PageThumb } from "@/components/app/PageThumb";
import { ImageViewer, useImageUrl } from "@/components/app/SourceImage";
import { ProgressBar, Sheet } from "@/components/ui/basics";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { lib, ready, update } = useLibrary();
  const router = useRouter();
  const [tab, setTab] = useState<"topics" | "pages">("topics");
  const [open, setOpen] = useState<Lesson | null>(null);
  const [focusOpen, setFocusOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!ready) return <Loading />;
  const project = lib.projects.find((p) => p.id === id);
  if (!project)
    return (
      <>
        <BackHeader href="/app" title="Not found" />
        <Page>
          <p className="py-10 text-center text-muted">This study set is gone.</p>
        </Page>
      </>
    );

  const lessons = projectLessons(lib, project.id);
  const next = currentLesson(lessons);
  const pages = lib.pages.filter((p) => p.projectId === project.id);
  const readyCount = readyLessonCount(lessons);
  const canTest = readyCount >= PRACTICE_TEST_READY_LESSONS;
  const cardCount = (lid: string) => lib.cards.filter((c) => c.lessonId === lid).length;
  const themes = lessons.filter((l) => l.kind === "theme");
  // Spec 13.5: ask once, right after a set is built.
  const askFocus = focusOpen || (!project.focusAsked && !project.sample && themes.length >= 2);
  const focused = themes.filter((l) => (project.focusLessons ?? []).includes(l.id));
  const setType = (t: "book" | "class" | "other") => update((l) => ({ ...l, projects: l.projects.map((x) => (x.id === project.id ? { ...x, type: t } : x)) }));

  return (
    <>
      <BackHeader
        href="/app"
        title={project.title}
        right={
          <button className="rounded-full px-3 py-2 text-[16px] font-bold text-muted hover:bg-shelf hover:text-ink" onClick={() => setDetailsOpen(true)}>
            Details
          </button>
        }
      />
      <Page>
        <section>
          <h1 className="text-[30px] font-black leading-tight tracking-tight">{project.title}</h1>
          <p className="mt-1 text-[16px] text-muted">
            {[project.author, `${lessons.length} topic${lessons.length === 1 ? "" : "s"}`, `${pages.length} page${pages.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
          </p>
          {next && (
            <Link href={`/app/learn/${next.id}`} className="btn btn-block mt-5">
              {next.sessions === 0 ? `Start ${next.title}` : `Continue ${next.title}`}
            </Link>
          )}
        </section>

        <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block rounded-[16px] bg-shelf p-4">
            <span className="block text-[14px] font-bold text-muted">Exam date</span>
            <input
              type="date"
              value={project.goalDate ?? ""}
              aria-label="Goal date"
              data-testid="goal-date"
              onChange={(e) => update((l) => ({ ...l, projects: l.projects.map((x) => (x.id === project.id ? { ...x, goalDate: e.target.value || undefined } : x)) }))}
              className="mt-1 w-full min-w-0 bg-transparent text-[17px] font-extrabold text-ink outline-none"
            />
          </label>
          <div className="rounded-[16px] bg-shelf p-4">
            <span className="block text-[14px] font-bold text-muted">Practice test</span>
            {canTest ? (
              <Link href={`/app/test/${project.id}`} className="mt-1 block text-[17px] font-extrabold text-blue hover:underline" data-testid="practice-test">
                Take the practice test
              </Link>
            ) : (
              <span className="mt-1 block text-[16px] font-bold">
                Opens when {PRACTICE_TEST_READY_LESSONS} topics reach level {READY_LEVEL} ({readyCount} now)
              </span>
            )}
          </div>
        </section>

        {pages.length > 0 && (
          <div className="mt-6">
            <AskBox lib={lib} pages={pages} scope="project" label={`Ask about ${project.title}`} update={update} />
          </div>
        )}
        <WordsToDefine
          words={wordsToDefine(lib, project.id)}
          onSave={(w, definition) => update((l) => logEvent(defineWord(l, project.id, w.pageId, w.term, definition), "word_defined", { source: "user" }))}
        />

        <div className="mt-10 grid grid-cols-2 gap-1 rounded-full bg-shelf p-1" role="tablist">
          {(["topics", "pages"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`h-10 rounded-full text-[16px] font-extrabold transition-colors ${tab === t ? "bg-paper text-ink shadow-sm" : "text-muted"}`}
            >
              {t === "topics" ? "Topics" : "Pages"}
            </button>
          ))}
        </div>

        {tab === "topics" ? (
          <ul className="mt-4 grid grid-cols-1 gap-1 pb-10" aria-label="Topics">
            {lessons.map((l) => (
              <li key={l.id}>
                <button className="flex w-full items-center gap-4 rounded-[14px] px-3 py-3 text-left hover:bg-shelf" onClick={() => setOpen(l)} aria-label={`${l.title}, level ${l.level} of 5`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] font-extrabold">{l.title}</span>
                    {next?.id === l.id ? (
                      <span className="block text-[15px] font-bold text-blue">Next up</span>
                    ) : (
                      l.summary && <span className="block truncate text-[15px] text-muted">{l.summary}</span>
                    )}
                  </span>
                  <span className="num flex-none text-[15px] font-bold text-muted">
                    {l.level >= 5 ? "Mastered" : `Level ${l.level}`}
                  </span>
                </button>
              </li>
            ))}
            {!lessons.length && <p className="py-8 text-center text-muted">No topics yet. Add more notes to this study set.</p>}
          </ul>
        ) : (
          <PagesTab lib={lib} projectId={project.id} pages={pages} update={update} onMoved={(pid) => router.push(`/app/p/${pid}`)} />
        )}
      </Page>

      {askFocus && (
        <FocusSheet
          key={project.id}
          project={project}
          themes={themes}
          onSave={(ids) => {
            update((l) => setFocus(l, project.id, ids));
            setFocusOpen(false);
          }}
        />
      )}

      <Sheet open={detailsOpen} onClose={() => setDetailsOpen(false)} label="Details">
        <h3 className="pr-8 text-[24px] font-black leading-tight">Details</h3>
        <p className="mt-5 text-[14px] font-bold text-muted">This is a</p>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-full bg-shelf p-1" role="radiogroup" aria-label="Project type">
          {(
            [
              ["class", "Class"],
              ["book", "Book"],
              ["other", "Other"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              role="radio"
              aria-checked={(project.type ?? "book") === t}
              onClick={() => setType(t)}
              className={`h-10 rounded-full text-[16px] font-extrabold ${(project.type ?? "book") === t ? "bg-paper text-ink shadow-sm" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {themes.length >= 2 && (
          <div className="mt-6" data-testid="focus-row">
            <p className="text-[14px] font-bold text-muted">Focus</p>
            <p className="mt-1 font-extrabold">{focused.map((l) => l.title).join(", ") || "Everything"}</p>
            <button
              className="mt-2 text-[16px] font-extrabold text-blue hover:underline"
              onClick={() => {
                setDetailsOpen(false);
                setFocusOpen(true);
              }}
            >
              Change focus
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={!!open} onClose={() => setOpen(null)} label="Topic">
        {open && (
          <div>
            <h3 className="pr-8 text-[24px] font-black leading-tight">{open.title}</h3>
            <p className="mt-2 text-muted">{open.summary}</p>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1">
                <ProgressBar value={open.level / 5} color="yellow" label="Level" />
              </div>
              <span className="text-[15px] font-extrabold text-muted">Level {open.level} of 5</span>
            </div>
            <p className="mt-2 text-[15px] text-muted">
              {cardCount(open.id)} {open.kind === "quotes" ? "quotes" : "cards"}, {open.sessions} session{open.sessions === 1 ? "" : "s"} done
            </p>
            <LessonCards lib={lib} lessonId={open.id} />
            <Link href={`/app/learn/${open.id}`} className="btn btn-block mt-6">
              {open.sessions === 0 ? "Start" : open.level >= 5 ? "Practice again" : "Continue"}
            </Link>
          </div>
        )}
      </Sheet>
    </>
  );
}

/** "What do you want to focus on?" (spec 13.5). Closing it means everything. */
function FocusSheet({ project, themes, onSave }: { project: Project; themes: Lesson[]; onSave: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(project.focusLessons ?? []));
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Sheet open onClose={() => onSave(project.focusAsked ? (project.focusLessons ?? []) : [])} label="Choose a focus">
      <h3 className="pr-8 text-[24px] font-black leading-tight">What do you want to focus on?</h3>
      <p className="mt-2 text-muted">{themes.length} topics found. Pick what matters most and we&apos;ll start there.</p>
      <div className="mt-5 grid grid-cols-1 gap-2.5">
        {themes.map((l) => (
          <button key={l.id} className="tile" aria-pressed={picked.has(l.id)} onClick={() => toggle(l.id)}>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-extrabold text-muted">{l.title}</span>
              <span className="mt-0.5 line-clamp-2 block font-bold leading-snug">{l.summary || l.title}</span>
            </span>
            {picked.has(l.id) && <Check size={20} strokeWidth={3} className="flex-none" />}
          </button>
        ))}
      </div>
      <button className="btn btn-block mt-6" disabled={!picked.size} onClick={() => onSave(themes.filter((l) => picked.has(l.id)).map((l) => l.id))}>
        Start with these
      </button>
      <button className="btn btn-secondary btn-block mt-3" onClick={() => onSave([])}>
        Everything
      </button>
    </Sheet>
  );
}

const CARD_LIST_MAX = 20;

/** The lesson's cards with the page image they came from (spec 11.1). */
function LessonCards({ lib, lessonId }: { lib: Library; lessonId: string }) {
  const cards = lib.cards.filter((c) => c.lessonId === lessonId);
  const pageById = new Map(lib.pages.map((p) => [p.id, p]));
  if (!cards.length) return null;
  return (
    <div className="mt-5">
      <p className="mb-2 text-[15px] font-extrabold">In this topic</p>
      <ul className="space-y-2">
        {cards.slice(0, CARD_LIST_MAX).map((c) => {
          const page = c.pageId ? pageById.get(c.pageId) : undefined;
          return (
            <li key={c.id} className="flex items-start gap-3 rounded-[12px] bg-shelf p-3">
              {page?.image && <CardThumb imageKey={page.image} />}
              <p className={`text-[15px] leading-snug ${c.kind === "quote" ? "serif" : "font-semibold"}`}>
                {c.kind === "picture" ? <span className="font-extrabold text-blue">Picture. </span> : null}
                {c.term ? <span className={`font-extrabold ${isCode(c.term) ? "code" : ""}`}>{c.term}: </span> : null}
                {truncate(c.term ? c.definition ?? "" : c.statement, 140)}
              </p>
            </li>
          );
        })}
      </ul>
      {cards.length > CARD_LIST_MAX && <p className="mt-2 text-[15px] font-bold text-muted">And {cards.length - CARD_LIST_MAX} more.</p>}
    </div>
  );
}

function CardThumb({ imageKey }: { imageKey: string }) {
  const url = useImageUrl(imageKey);
  const [open, setOpen] = useState(false);
  if (!url) return <span className="h-12 w-9 flex-none rounded-[6px] bg-shelf" />;
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Open the page image" className="flex-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="h-12 w-9 rounded-[6px] border-2 border-line object-cover object-top" />
      </button>
      {open && <ImageViewer url={url} onClose={() => setOpen(false)} />}
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
    <section className="mt-4 grid grid-cols-1 gap-3 pb-10">
      {pages.map((p) => (
        <article key={p.id} className="flex gap-4 rounded-[16px] bg-shelf p-4">
          <div className="w-[72px] flex-none">
            <PageThumb page={p} />
          </div>
          <div className="min-w-0 flex-1">
            {(p.heading ?? p.header) && <p className="truncate font-extrabold">{p.heading ?? p.header}</p>}
            {p.sourceName && <p className="truncate text-[14px] text-muted">{p.sourceIndex ? `${p.sourceName}, ${p.kind === "slides" ? "slide" : "page"} ${p.sourceIndex}` : p.sourceName}</p>}
            <p className="serif mt-0.5 line-clamp-4 text-[16px] leading-snug">{p.text}</p>
            <div className="mt-3 flex flex-wrap gap-4">
              {(project.type ?? "book") === "book" && (
                <button className="text-[16px] font-bold text-muted hover:text-ink" onClick={() => setQuotePage(p)}>
                  Mark as quote
                </button>
              )}
              {lib.projects.length > 1 && (
                <button className="text-[16px] font-bold text-muted hover:text-ink" onClick={() => setMovePage(p)}>
                  Move
                </button>
              )}
              <button
                className="text-[16px] font-bold text-muted hover:text-red"
                onClick={() => {
                  if (!confirm("Delete this page and its cards?")) return;
                  if (p.image) void deleteImage(p.image);
                  update((l) => removePageCards({ ...l, pages: l.pages.filter((x) => x.id !== p.id) }, p.id));
                }}
              >
                Delete
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
            <h3 className="pr-8 text-[22px] font-black">Move to another study set</h3>
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

/** Word-list entries without a definition get no card until the user writes one (spec 10.2). */
function WordsToDefine({ words, onSave }: { words: { term: string; pageId: string }[]; onSave: (w: { term: string; pageId: string }, definition: string) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  if (!words.length) return null;
  const shown = open ? words : words.slice(0, 5);
  return (
    <section className="mt-6 rounded-[16px] bg-shelf p-4" data-testid="words-to-define">
      <p className="font-extrabold">
        {words.length} word{words.length === 1 ? " needs a definition" : "s need a definition"}
      </p>
      <p className="text-[15px] text-muted">Write what each one means in a few words. Each saved word becomes a card.</p>
      <ul className="mt-3 grid gap-2">
        {shown.map((w) => {
          const k = w.term.toLowerCase();
          const v = drafts[k] ?? "";
          return (
            <li key={k}>
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!v.trim()) return;
                  onSave(w, v);
                  setDrafts((d) => ({ ...d, [k]: "" }));
                }}
              >
                <span className="w-full font-black sm:w-[140px] sm:truncate">{w.term}</span>
                <input className="input !py-2 min-w-0 flex-1" value={v} placeholder="Meaning" aria-label={`Meaning of ${w.term}`} onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))} />
                <button className="btn btn-sm flex-none" disabled={!v.trim()}>
                  Save
                </button>
              </form>
            </li>
          );
        })}
      </ul>
      {words.length > shown.length && (
        <button className="mt-3 text-[15px] font-bold text-blue hover:underline" onClick={() => setOpen(true)}>
          Show all {words.length}
        </button>
      )}
    </section>
  );
}

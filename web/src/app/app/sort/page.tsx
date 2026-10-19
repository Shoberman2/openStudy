"use client";

import { BookPlus, Check, LoaderCircle, Quote, Lightbulb, MoreHorizontal, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BuildResult, QuoteDraft } from "@/engine/builder";
import { UNSORTED } from "@/engine/grouping";
import { createProject, extendProject, inboxPages, logEvent, materialize } from "@/engine/library";
import type { Library, Page as LibPage, Project, ProjectType } from "@/engine/types";
import { newId } from "@/engine/util";
import { buildLessons, suggestGroups } from "@/lib/ai";
import { toBuildPages } from "@/lib/actions";
import { deleteImage } from "@/lib/images";
import { useLibrary } from "@/lib/store";
import { BackHeader, Loading, Page } from "@/components/app/AppChrome";
import { PageThumb } from "@/components/app/PageThumb";
import { Sheet } from "@/components/ui/basics";
import { OptionTile } from "@/components/ui/OptionTile";

type Group = { key: string; title: string; author: string; pageIds: string[]; type: ProjectType };

const TYPES: [ProjectType, string][] = [
  ["book", "Book"],
  ["class", "Class"],
  ["other", "Other"],
];

export default function SortPage() {
  const { lib, ready, update } = useLibrary();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [smart, setSmart] = useState(false);
  const [creating, setCreating] = useState<Group | null>(null);
  const [movePage, setMovePage] = useState<{ pageId: string; from: string } | null>(null);
  const inbox = useMemo(() => inboxPages(lib), [lib]);
  const inboxIds = useMemo(() => new Set(inbox.map((p) => p.id)), [inbox]);
  const started = useRef(false);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void suggestGroups(inbox).then(({ groups: g, smart: s }) => {
      setGroups(g.map((x) => ({ key: x.key, title: x.title, author: x.author ?? "", pageIds: x.pageIds, type: x.type ?? "book" })));
      setSmart(s);
    });
  }, [ready, inbox]);

  // Newly imported pages that are not in any group yet go to Unsorted.
  useEffect(() => {
    if (!groups) return;
    const known = new Set(groups.flatMap((g) => g.pageIds));
    const extra = inbox.filter((p) => !known.has(p.id)).map((p) => p.id);
    if (!extra.length) return;
    // Syncing local sort state with pages that arrive from storage after first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroups((gs) => {
      const u = gs!.find((g) => g.title === UNSORTED);
      if (u) return gs!.map((g) => (g === u ? { ...g, pageIds: [...g.pageIds, ...extra] } : g));
      return [...gs!, { key: `u${Date.now()}`, title: UNSORTED, author: "", pageIds: extra, type: "other" as ProjectType }];
    });
  }, [groups, inbox]);

  const visible = useMemo(
    () => (groups ? groups.map((g) => ({ ...g, pageIds: g.pageIds.filter((id) => inboxIds.has(id)) })).filter((g) => g.pageIds.length) : null),
    [groups, inboxIds],
  );

  if (!ready) return <Loading />;
  const byId = new Map(lib.pages.map((p) => [p.id, p]));

  // Every edit is written onto the pages (suggestedTitle / suggestedAuthor), which grouping uses
  // first, so a reload rebuilds exactly the groups the user arranged.
  const commit = (next: Group[]) => {
    setGroups(next);
    const assign = new Map<string, { title?: string; author?: string }>();
    for (const g of next) for (const id of g.pageIds) assign.set(id, { title: g.title.trim() || undefined, author: g.author.trim() || undefined });
    update((l) => ({
      ...l,
      pages: l.pages.map((p) => {
        const a = assign.get(p.id);
        return a && p.projectId === null ? { ...p, suggestedTitle: a.title, suggestedAuthor: a.author } : p;
      }),
    }));
  };
  const edit = (key: string, patch: Partial<Group>) => commit(groups!.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const discard = (pageId: string) => {
    const pg = byId.get(pageId);
    if (pg?.image) void deleteImage(pg.image);
    update((l) => ({ ...l, pages: l.pages.filter((p) => p.id !== pageId) }));
  };
  const doMove = (pageId: string, toKey: string | "new") => {
    let next = groups!.map((g) => ({ ...g, pageIds: g.pageIds.filter((id) => id !== pageId) }));
    if (toKey === "new") {
      const taken = new Set(next.map((g) => g.title.toLowerCase()));
      let title = "New book";
      for (let i = 2; taken.has(title.toLowerCase()); i++) title = `New book ${i}`;
      next = [...next, { key: `new:${pageId}`, title, author: "", pageIds: [pageId], type: groups!.find((g) => g.pageIds.includes(pageId))?.type ?? "book" }];
    } else next = next.map((g) => (g.key === toKey ? { ...g, pageIds: [...g.pageIds, pageId] } : g));
    commit(next.filter((g) => g.pageIds.length));
    setMovePage(null);
  };

  const addToExisting = async (g: Group, project: Project) => {
    const pages = g.pageIds.map((id) => byId.get(id)!).filter(Boolean);
    const { result } = await buildLessons({ title: project.title, author: project.author, type: project.type }, toBuildPages(pages), lib.profile);
    update((l) => {
      const hasQuotes = l.lessons.some((x) => x.projectId === project.id && x.kind === "quotes");
      const next = extendProject(l, project.id, g.pageIds, result, hasQuotes || project.focus === "ideas+quotes" ? result.quotes : []);
      return logEvent(next, "pages_added", { pages: g.pageIds.length, projectId: project.id });
    });
    router.push(`/app/p/${project.id}`);
  };

  return (
    <>
      <BackHeader href="/app" title="Sort pages" />
      <Page>
        {!visible ? (
          <div className="flex items-center gap-3 py-16 text-muted">
            <LoaderCircle className="animate-spin" size={22} /> Grouping pages by book
          </div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <h2 className="text-[24px] font-black">Nothing to sort</h2>
            <p className="mt-1 text-muted">New pages land here after you import them.</p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/app/import" className="btn">
                Import pages
              </Link>
              <Link href="/app" className="btn btn-secondary">
                Home
              </Link>
            </div>
          </div>
        ) : (
          <>
            <h2 className="text-[26px] font-black leading-tight tracking-tight">
              {visible.length} suggested project{visible.length === 1 ? "" : "s"}
            </h2>
            <p className="mt-1 text-muted">
              Check the titles, move any page that landed in the wrong pile, then create the project.
              {smart ? " Sorted with smart organize." : ""}
            </p>
            {smart && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[14px] font-bold text-blue">
                <Sparkles size={16} /> Smart organize on
              </p>
            )}
            <div className="mt-6 grid grid-cols-1 gap-5">
              {visible.map((g) => {
                const match = lib.projects.find((p) => p.title.trim().toLowerCase() === g.title.trim().toLowerCase());
                return (
                  <section key={g.key} className="card p-4 sm:p-5" data-testid="sort-group">
                    <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
                      <input className="input !py-2.5 !text-[18px] !font-extrabold" value={g.title} aria-label="Book title" onChange={(e) => edit(g.key, { title: e.target.value })} />
                      <input className="input !py-2.5" value={g.author} placeholder="Author" aria-label="Author" onChange={(e) => edit(g.key, { author: e.target.value })} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[14px] font-bold text-muted">
                        {g.pageIds.length} page{g.pageIds.length === 1 ? "" : "s"}
                        {(() => {
                          const files = new Set(g.pageIds.map((id) => byId.get(id)?.sourceName).filter(Boolean)).size;
                          return files > 1 ? ` from ${files} files` : "";
                        })()}
                      </p>
                      <div className="flex gap-1 rounded-[12px] bg-shelf p-1" role="radiogroup" aria-label="Project type">
                        {TYPES.map(([t, label]) => (
                          <button
                            key={t}
                            role="radio"
                            aria-checked={g.type === t}
                            onClick={() => setGroups((gs) => gs!.map((x) => (x.key === g.key ? { ...x, type: t } : x)))}
                            className={`h-8 rounded-[9px] px-3 text-[14px] font-extrabold ${g.type === t ? "bg-paper text-ink shadow-[0_2px_0_var(--line)]" : "text-muted"}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <ul className="no-scrollbar -mx-4 mt-2 flex gap-3 overflow-x-auto px-4 pb-1 sm:-mx-5 sm:px-5">
                      {g.pageIds.map((id) => {
                        const pg = byId.get(id);
                        if (!pg) return null;
                        return (
                          <li key={id} className="relative w-[104px] flex-none">
                            <PageThumb page={pg} />
                            <button
                              onClick={() => setMovePage({ pageId: id, from: g.key })}
                              aria-label="Page options"
                              className="absolute right-1.5 top-1.5 rounded-full bg-paper p-1 text-ink shadow-[0_2px_0_var(--line)]"
                            >
                              <MoreHorizontal size={16} strokeWidth={2.75} />
                            </button>
                            <p className="mt-1 line-clamp-2 text-[12px] font-semibold text-muted">{pg.heading ?? pg.header ?? pg.text.slice(0, 60)}</p>
                            {pg.sourceName && <p className="truncate text-[11px] font-bold text-muted/80">{pg.sourceIndex ? `${pg.sourceName}, ${pg.sourceIndex}` : pg.sourceName}</p>}
                          </li>
                        );
                      })}
                    </ul>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {match ? (
                        <button className="btn btn-block" onClick={() => void addToExisting(g, match)}>
                          Add all to {match.title.length > 22 ? match.title.slice(0, 21) + "…" : match.title}
                        </button>
                      ) : (
                        <button className="btn btn-block" onClick={() => setCreating(g)} disabled={!g.title.trim()}>
                          <BookPlus size={20} strokeWidth={2.5} /> Create project
                        </button>
                      )}
                      {lib.projects.length > 0 ? (
                        <select
                          className="input !h-[52px] !py-0 font-bold"
                          aria-label="Merge into existing project"
                          value=""
                          onChange={(e) => {
                            const p = lib.projects.find((x) => x.id === e.target.value);
                            if (p) void addToExisting(g, p);
                          }}
                        >
                          <option value="">Merge into a project</option>
                          {lib.projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.title}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button className="btn btn-secondary btn-block" onClick={() => g.pageIds.forEach(discard)}>
                          Discard these pages
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </Page>

      <Sheet open={!!movePage} onClose={() => setMovePage(null)} label="Move page">
        {movePage && (
          <>
            <h3 className="pr-8 text-[20px] font-black">Move this page</h3>
            <p className="serif mt-2 line-clamp-3 text-muted">{byId.get(movePage.pageId)?.text}</p>
            <div className="mt-4 grid grid-cols-1 gap-2.5">
              {(visible ?? [])
                .filter((g) => g.key !== movePage.from)
                .map((g) => (
                  <button key={g.key} className="tile" onClick={() => doMove(movePage.pageId, g.key)}>
                    {g.title}
                  </button>
                ))}
              <button className="tile" onClick={() => doMove(movePage.pageId, "new")}>
                A new book
              </button>
              <button
                className="tile !text-red"
                onClick={() => {
                  discard(movePage.pageId);
                  setMovePage(null);
                }}
              >
                <Trash2 size={20} strokeWidth={2.5} /> Discard page
              </button>
            </div>
          </>
        )}
      </Sheet>

      {creating && (
        <CreateFlow
          group={creating}
          pages={creating.pageIds.map((id) => byId.get(id)!).filter(Boolean)}
          lib={lib}
          onClose={() => setCreating(null)}
          onCreate={(projectId, fn) => {
            update(fn);
            setCreating(null);
            router.push(`/app/p/${projectId}`);
          }}
        />
      )}
    </>
  );
}

function CreateFlow({
  group,
  pages,
  lib,
  onClose,
  onCreate,
}: {
  group: Group;
  pages: LibPage[];
  lib: Library;
  onClose: () => void;
  onCreate: (projectId: string, fn: (l: Library) => Library) => void;
}) {
  const [step, setStep] = useState<"focus" | "building" | "quotes">(group.type === "book" ? "focus" : "building");
  const [focus, setFocus] = useState<Project["focus"] | null>(null);
  const [build, setBuild] = useState<BuildResult | null>(null);
  const [wantQuotes, setWantQuotes] = useState<boolean | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const title = group.title.trim();

  const finish = (b: BuildResult, quotes: QuoteDraft[], asked: boolean, yes: boolean, f: Project["focus"]) => {
    const projectId = newId();
    const built = materialize(projectId, b, yes ? quotes : []);
    onCreate(projectId, (l) => {
      // The exam date from onboarding goes to the first class project.
      const pending = group.type === "class" ? l.profile.pendingGoalDate : undefined;
      let next = createProject(
        l,
        { title, author: group.author, focus: f, quotesAsked: asked, type: group.type, goalDate: pending },
        pages.map((p) => p.id),
        { ...built, projectId },
      );
      if (pending) next = { ...next, profile: { ...next.profile, pendingGoalDate: undefined } };
      next = logEvent(next, "project_created", { pages: pages.length, lessons: built.lessons.length, projectId, type: group.type });
      if (asked) next = logEvent(next, "quotes_answer", { yes, count: yes ? quotes.length : 0 });
      return next;
    });
  };

  const choose = async (f: Project["focus"]) => {
    setFocus(f);
    setStep("building");
    const { result } = await buildLessons({ title, author: group.author || undefined, type: group.type }, toBuildPages(pages), lib.profile);
    setBuild(result);
    // The quotes question is only for books, or when there are verbatim excerpts (spec 8.4).
    const askQuotes = group.type === "book" || pages.some((p) => p.verbatim);
    if (askQuotes && result.quotes.length > 0) {
      setWantQuotes(f === "ideas+quotes" ? true : null);
      setTicked(new Set(result.quotes.map((_, i) => i)));
      setStep("quotes");
    } else {
      finish(result, [], false, false, f);
    }
  };

  const autoStarted = useRef(false);
  useEffect(() => {
    if (group.type === "book" || autoStarted.current) return;
    autoStarted.current = true;
    void choose("ideas");
  });

  return (
    <Sheet open onClose={onClose} label="Create project">
      {step === "focus" && (
        <div className="anim-fade">
          <p className="kicker">{pages.length} pages</p>
          <h3 className="mt-1 pr-8 text-[24px] font-black leading-tight">How do you want to study {title}?</h3>
          <div className="mt-5 grid grid-cols-1 gap-3">
            <OptionTile icon={<Lightbulb size={24} strokeWidth={2.5} />} label="Big ideas" sub="Themes and key facts" selected={focus === "ideas"} onClick={() => void choose("ideas")} />
            <OptionTile icon={<Quote size={24} strokeWidth={2.5} />} label="Ideas and exact quotes" sub="Also learn the best lines word for word" selected={focus === "ideas+quotes"} onClick={() => void choose("ideas+quotes")} />
          </div>
        </div>
      )}
      {step === "building" && (
        <div className="flex items-center gap-3 py-10 font-bold text-muted">
          <LoaderCircle className="animate-spin" size={22} /> Building lessons for {title}
        </div>
      )}
      {step === "quotes" && build && (
        <div className="anim-fade">
          <h3 className="pr-8 text-[22px] font-black leading-tight">
            We found {build.quotes.length} line{build.quotes.length === 1 ? "" : "s"} that read like quotes. Want a Quotes lesson so you learn the exact wording?
          </h3>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="tile justify-center" aria-pressed={wantQuotes === true} onClick={() => setWantQuotes(true)}>
              Yes, make it
            </button>
            <button className="tile justify-center" aria-pressed={wantQuotes === false} onClick={() => setWantQuotes(false)}>
              No, just the ideas
            </button>
          </div>
          {wantQuotes && (
            <ul className="mt-5 grid max-h-[40dvh] gap-2 overflow-y-auto pr-1">
              {build.quotes.map((q, i) => {
                const on = ticked.has(i);
                return (
                  <li key={i}>
                    <button
                      onClick={() => {
                        const n = new Set(ticked);
                        if (on) n.delete(i);
                        else n.add(i);
                        setTicked(n);
                      }}
                      className={`flex w-full items-start gap-3 rounded-[12px] border-2 p-3 text-left ${on ? "border-blue bg-blue-soft" : "border-line"}`}
                      aria-pressed={on}
                    >
                      <span className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-[7px] border-2 ${on ? "border-blue bg-blue text-white" : "border-[var(--line-strong)]"}`}>
                        {on && <Check size={16} strokeWidth={3.5} />}
                      </span>
                      <span className="serif text-[16px] leading-snug">{q.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            className="btn btn-block mt-6"
            disabled={wantQuotes === null || (wantQuotes && ticked.size === 0)}
            onClick={() => finish(build, build.quotes.filter((_, i) => ticked.has(i)), true, !!wantQuotes, focus ?? "ideas")}
          >
            Build my lessons
          </button>
        </div>
      )}
    </Sheet>
  );
}

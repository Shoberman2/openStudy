"use client";

import { isNotesExport, type NotesExport } from "@/engine/applenotes";
import { buildOffline, type BuildResult } from "@/engine/builder";
import { CATEGORY_NAMES } from "@/engine/categories";
import { localAnswer, retrieve, type Passage } from "@/engine/ask";
import { buildProject, wordLessons, type ClassPage } from "@/engine/classbuilder";
import { withPictures } from "@/engine/pictures";
import { groupPages, orderByPageNumber, type GroupPage, type SuggestedGroup } from "@/engine/grouping";
import type { Page, Profile, ProjectType } from "@/engine/types";
import type { WrittenConcept } from "@/engine/written";

let health: Promise<{ ai: boolean; notes: boolean }> | null = null;

function getHealth() {
  if (!health)
    health = fetch("/api/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((j: { ai?: boolean; notes?: boolean }) => ({ ai: !!j.ai, notes: !!j.notes }))
      .catch(() => ({ ai: false, notes: false }));
  return health;
}

export function smartOrganizeOn(): Promise<boolean> {
  return getHealth().then((h) => h.ai);
}

/** True when this web app runs locally on a Mac with Apple Notes access turned on (spec 9.2). */
export function localNotesOn(): Promise<boolean> {
  return getHealth().then((h) => h.notes);
}

/** Every Apple Note via the local route, or why it failed. */
export async function fetchLocalNotes(): Promise<NotesExport | "permission" | "failed"> {
  try {
    const r = await fetch("/api/notes", { cache: "no-store" });
    if (r.status === 403) return "permission";
    if (!r.ok) return "failed";
    const j: unknown = await r.json();
    return isNotesExport(j) ? j : "failed";
  } catch {
    return "failed";
  }
}

async function post<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** Smart organize when the server has a key, else the offline grouping. */
export async function suggestGroups(all: GroupPage[], shelfCategories: string[] = []): Promise<{ groups: SuggestedGroup[]; smart: boolean }> {
  // Word lists never need the model: they always form the Words group (spec 10.2).
  const wordPages = all.filter((p) => p.words?.length && !p.suggestedTitle);
  if (wordPages.length && wordPages.length < all.length) {
    const rest = await suggestGroups(all.filter((p) => !wordPages.includes(p)), shelfCategories);
    return { groups: [...groupPages(wordPages), ...rest.groups], smart: rest.smart };
  }
  const pages = all;
  const offline = () => ({ groups: groupPages(pages), smart: false });
  // Pages with an exact Notes title never need the model.
  if (!pages.length || pages.every((p) => p.suggestedTitle)) return offline();
  if (!(await smartOrganizeOn())) return offline();
  // The route sorts up to 400 pages per call; a whole Notes library is chunked and merged by title.
  type AiGroup = { title: string; author?: string; pageIds: string[]; type?: ProjectType; category?: string };
  const merged = new Map<string, AiGroup>();
  const categories = new Set([...shelfCategories, ...CATEGORY_NAMES]);
  for (let i = 0; i < pages.length; i += 300) {
    const chunk = pages.slice(i, i + 300);
    const r = await post<{ groups: AiGroup[] }>("/api/sort", {
      pages: chunk.map((p) => ({ id: p.id, header: p.header ?? p.heading, source: p.sourceName, folder: p.folder, text: p.text.slice(0, 700) })),
      categories: [...categories],
    });
    if (!r?.groups?.length) return offline();
    for (const g of r.groups) {
      const k = g.title.trim().toLowerCase();
      const hit = merged.get(k);
      if (hit) hit.pageIds.push(...g.pageIds);
      else merged.set(k, { ...g, pageIds: [...g.pageIds] });
      if (g.category) categories.add(g.category);
    }
  }
  const res = { groups: [...merged.values()] };
  const offlineGroups = groupPages(pages);
  const like = (ids: string[]) => offlineGroups.find((g) => g.pageIds.some((id) => ids.includes(id)));
  const byId = new Map(pages.map((p) => [p.id, p]));
  return {
    groups: res.groups.map((g, i) => ({
      key: `ai${i}`,
      title: g.title,
      author: g.author,
      pageIds: orderByPageNumber(g.pageIds.map((id) => byId.get(id)).filter((p): p is GroupPage => !!p)).map((p) => p.id),
      type: g.type ?? like(g.pageIds)?.type,
      category: g.category?.trim() || like(g.pageIds)?.category,
    })),
    smart: true,
  };
}

export async function buildLessons(
  project: { title: string; author?: string; type?: ProjectType },
  pages: ClassPage[],
  profile: Profile,
): Promise<{ result: BuildResult; smart: boolean }> {
  const offline = () => ({ result: buildProject(project, pages), smart: false });
  if (!(await smartOrganizeOn())) return offline();
  // Word lists always build offline from their entries; only the rest goes to the model.
  const wordPages = pages.filter((p) => p.words?.length);
  if (wordPages.length) {
    const rest = pages.filter((p) => !p.words?.length);
    const other = rest.length ? await buildLessons(project, rest, profile) : { result: { lessons: [], quotes: [] }, smart: false };
    return { result: { lessons: [...wordLessons(wordPages), ...other.result.lessons], quotes: other.result.quotes }, smart: other.smart };
  }
  const res = await post<BuildResult>("/api/build", {
    project: { title: project.title, author: project.author, type: project.type },
    pages: pages.map((p) => ({ id: p.id, text: [p.heading, p.text].filter(Boolean).join("\n") })),
    profile: { goals: profile.goals, practice: profile.practice },
    wantQuotes: true,
  });
  if (!res?.lessons?.length) return offline();
  // Keep offline verbatim excerpts as quote candidates too.
  const off = project.type === "class" ? { quotes: [] } : buildOffline(project, pages);
  const seen = new Set(res.quotes.map((q) => q.text.toLowerCase()));
  const quotes = [...res.quotes, ...off.quotes.filter((q) => !seen.has(q.text.toLowerCase()))].slice(0, 20);
  return { result: withPictures({ lessons: res.lessons, quotes }, pages), smart: true };
}

/** Read an image with Claude vision (spec 8.2). Returns null when unavailable so callers fall back to OCR. */
export async function readImageSmart(canvas: HTMLCanvasElement): Promise<{ text: string; heading?: string } | null> {
  if (!(await smartOrganizeOn())) return null;
  const scale = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * scale);
  c.height = Math.round(canvas.height * scale);
  c.getContext("2d")!.drawImage(canvas, 0, 0, c.width, c.height);
  const image = c.toDataURL("image/jpeg", 0.85).split(",")[1];
  const res = await post<{ text?: string; heading?: string }>("/api/read", { image, mediaType: "image/jpeg" });
  if (!res?.text?.trim()) return null;
  return { text: res.text, heading: res.heading || undefined };
}

/**
 * Fill in missing word-list definitions with smart organize (spec 10.2). Returns the pages with
 * definitions added and how many were defined; on any failure the pages come back unchanged.
 */
export async function smartDefine(pages: Page[]): Promise<{ pages: Page[]; count: number }> {
  const missing = [...new Set(pages.flatMap((p) => (p.words ?? []).filter((w) => !w.definition).map((w) => w.term)))];
  if (!missing.length || !(await smartOrganizeOn())) return { pages, count: 0 };
  const found = new Map<string, string>();
  for (let i = 0; i < missing.length; i += 80) {
    const r = await post<{ definitions: { term: string; definition: string }[] }>("/api/define", { words: missing.slice(i, i + 80) });
    for (const d of r?.definitions ?? []) if (d.term && d.definition?.trim()) found.set(d.term.toLowerCase(), d.definition.trim());
  }
  if (!found.size) return { pages, count: 0 };
  let count = 0;
  const out = pages.map((p) =>
    p.words?.some((w) => !w.definition && found.has(w.term.toLowerCase()))
      ? {
          ...p,
          words: p.words.map((w) => {
            const d = w.definition ? undefined : found.get(w.term.toLowerCase());
            if (!d) return w;
            count++;
            return { ...w, definition: d };
          }),
        }
      : p,
  );
  return { pages: out, count };
}

export type AskResult = { smart: true; answer: string; citations: Passage[] } | { smart: false; grounded: boolean; passages: Passage[]; fallback: boolean };

/**
 * Ask a question about some pages (spec 10.7). Smart when the model gives a grounded, cited answer;
 * otherwise the closest passages from the notes. `grounded: false` means nothing matched at all.
 */
export async function askNotes(question: string, pages: { id: string; title: string; text: string }[]): Promise<AskResult> {
  // `fallback`: the model was asked but its answer was not grounded in the notes.
  const offline = (fallback = false): AskResult => {
    const passages = localAnswer(question, pages);
    return { smart: false, grounded: passages.length > 0, passages, fallback };
  };
  const top = retrieve(question, pages);
  if (!top.length || !(await smartOrganizeOn())) return offline();
  const r = await post<{ answer: string; grounded: boolean; citations: { pageId: string; quote: string }[] }>("/api/ask", {
    question,
    pages: top.map(({ page }) => ({ id: page.id, title: page.title, text: page.text.slice(0, 3000) })),
  });
  if (!r?.grounded || !r.citations?.length) return offline(true);
  return { smart: true, answer: r.answer, citations: r.citations.map((c) => ({ pageId: c.pageId, text: c.quote })) };
}

/** Concept questions for a lesson's cards from the server (spec 13.6); null when there is no model or it failed. */
export async function writeConcepts(
  lesson: { title: string },
  project: { title: string; type?: ProjectType },
  cards: { id: string; text: string }[],
): Promise<WrittenConcept[] | null> {
  if (!cards.length || !(await smartOrganizeOn())) return null;
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 25_000));
  const res = await Promise.race([post<{ cards: WrittenConcept[] }>("/api/questions", { lesson, project, cards }), timeout]);
  return res?.cards ?? null;
}

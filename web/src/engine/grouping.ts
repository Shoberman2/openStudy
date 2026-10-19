// Offline grouping of inbox pages into suggested projects (spec 3.3, extended by 8.3).
import { cleanFileTitle } from "./formats";
import { centroid, cosine, tfidf } from "./tfidf";
import { STOPWORDS, tokens, words } from "./text";
import type { PageKind, ProjectType } from "./types";
import { titleCase } from "./util";

export type GroupPage = {
  id: string;
  text: string;
  header?: string;
  suggestedTitle?: string;
  suggestedAuthor?: string;
  kind?: PageKind;
  sourceName?: string;
  sourceIndex?: number;
  sourceTitle?: string;
  heading?: string;
  verbatim?: boolean;
  createdAt?: string;
};
export type SuggestedGroup = { key: string; title: string; author?: string; pageIds: string[]; type?: ProjectType };

/** Header key: lowercase, digits and punctuation stripped (page numbers vary). */
export function normalizeKey(s?: string): string {
  return (s ?? "").toLowerCase().replace(/[\d\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** Title key: like normalizeKey but keeps digits, so "BIO 101" and "BIO 102" stay apart. */
function titleKey(s?: string): string {
  return (s ?? "").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function mostCommon(values: string[]): string | undefined {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  let best: string | undefined;
  let bc = 0;
  for (const [v, c] of m) if (c > bc) [best, bc] = [v, c];
  return best;
}

export const UNSORTED = "Unsorted";
export const COURSE_CODE = /\b([A-Z]{2,5})\s?-?(\d{2,4}[A-Z]?)\b/g;
const FILE_KINDS = new Set<PageKind>(["pdf", "slides", "doc"]);
const LECTURE_NAME = /\b(lecture|lec\s?\d|week\s?\d|slides|syllabus|midterm|final exam|seminar|tutorial|lab\s?\d)\b/i;
const THREE_HOURS = 3 * 3600 * 1000;
const NOT_CODES = new Set(["ISBN", "PAGE", "FIG", "TABLE", "COVID", "MP", "PM", "AM", "ID", "PDF", "USB", "UTC", "GMT"]);

/** First course code in a text, normalized to "BIO 101", with the words that follow it. */
export function findCourseCode(text: string): { code: string; following?: string } | null {
  for (const m of text.matchAll(COURSE_CODE)) {
    if (NOT_CODES.has(m[1])) continue;
    const code = `${m[1]} ${m[2]}`;
    const after = text.slice((m.index ?? 0) + m[0].length).split("\n")[0];
    const following = after
      .replace(/^[\s:\-\u2013|,.]+/, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .filter((w, i, a) => /^[A-Z&][\p{L}&'-]*$/u.test(w) && a.slice(0, i).every((x) => /^[A-Z&][\p{L}&'-]*$/u.test(x)))
      .join(" ")
      .replace(/[,.:;]+$/, "");
    return { code, following: following || undefined };
  }
  return null;
}

function contentTokens(s: string): Set<string> {
  return new Set(words(s).filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w)));
}

/** Titles share >= 50% of their non-stopword tokens (relative to the shorter title). */
export function titlesOverlap(a: string, b: string): boolean {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}

type G = { titles: string[]; authors: string[]; ids: string[]; course?: boolean };

export function groupPages(pages: GroupPage[]): SuggestedGroup[] {
  const groups = new Map<string, G>();
  const byId = new Map(pages.map((p) => [p.id, p]));
  const add = (key: string, id: string, title: string, author?: string, course = false) => {
    const g = groups.get(key) ?? { titles: [], authors: [], ids: [] };
    g.titles.push(title);
    if (author) g.authors.push(author);
    g.ids.push(id);
    if (course) g.course = true;
    groups.set(key, g);
  };

  // 1. suggestedTitle wins (Books footer, user edits on Sort).
  let rest: GroupPage[] = [];
  for (const p of pages) {
    const k = titleKey(p.suggestedTitle);
    if (k === "unsorted") add("unsorted", p.id, UNSORTED);
    else if (k) add("t:" + k, p.id, p.suggestedTitle!.trim(), p.suggestedAuthor);
    else rest.push(p);
  }

  // 2-3. Files (PDF, slides, docs) are units. Course codes on a file's first 2 pages join files.
  const files = new Map<string, GroupPage[]>();
  const loose: GroupPage[] = [];
  for (const p of rest) {
    if (p.sourceName && p.kind && FILE_KINDS.has(p.kind)) {
      const f = files.get(p.sourceName) ?? [];
      f.push(p);
      files.set(p.sourceName, f);
    } else loose.push(p);
  }
  const units: { name: string; title: string; ids: string[] }[] = [];
  for (const [name, fp] of files) {
    fp.sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
    const firstTwo = fp.slice(0, 2).map((p) => [p.heading ?? "", p.text].join("\n")).join("\n");
    const cc = findCourseCode([name, firstTwo].join("\n"));
    if (cc) {
      const key = "c:" + cc.code.replace(/\s/g, "").toLowerCase();
      fp.forEach((p) => add(key, p.id, cc.following ? `${cc.code}: ${cc.following}` : cc.code, undefined, true));
      continue;
    }
    const title = fp[0].sourceTitle?.trim() || fp[0].heading?.trim() || cleanFileTitle(name);
    units.push({ name, title, ids: fp.map((p) => p.id) });
  }
  // Merge file units whose titles overlap (union in import order).
  const merged: { title: string; ids: string[]; titles: string[] }[] = [];
  for (const u of units) {
    const hit = merged.find((m) => m.titles.some((t) => titlesOverlap(t, u.title)));
    if (hit) {
      hit.ids.push(...u.ids);
      hit.titles.push(u.title);
    } else merged.push({ title: u.title, ids: [...u.ids], titles: [u.title] });
  }
  for (const m of merged) {
    const key = "t:" + titleKey(m.title);
    m.ids.forEach((id) => add(key, id, m.title));
  }

  // 4. Photos taken within 3 hours of each other form one pile.
  const photos = loose.filter((p) => p.kind === "photo").sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  rest = loose.filter((p) => p.kind !== "photo");
  const piles: GroupPage[][] = [];
  for (const p of photos) {
    const last = piles[piles.length - 1];
    const prev = last?.[last.length - 1];
    const gap = prev ? Date.parse(p.createdAt ?? "") - Date.parse(prev.createdAt ?? "") : Infinity;
    if (last && Number.isFinite(gap) && gap <= THREE_HOURS) last.push(p);
    else piles.push([p]);
  }

  // Screenshots: headers seen on >= 2 pages form groups (spec 3.3).
  const headerCount = new Map<string, number>();
  for (const p of rest) {
    const k = normalizeKey(p.header);
    if (k) headerCount.set(k, (headerCount.get(k) ?? 0) + 1);
  }
  const orphans: GroupPage[][] = [];
  for (const p of rest) {
    const k = normalizeKey(p.header);
    // Same key space as titles, so a header group merges with pages the user moved into it.
    if (k && (headerCount.get(k) ?? 0) >= 2) add("t:" + k, p.id, titleCase(p.header!.trim()));
    else orphans.push([p]);
  }

  // Orphan pages and photo piles join the closest group (cosine > 0.12), else stand alone.
  const units2 = [...piles.map((pile) => ({ pile, photo: true })), ...orphans.map((pile) => ({ pile, photo: false }))];
  if (units2.length) {
    const keys = [...groups.keys()].filter((k) => k !== "unsorted");
    const docs = [
      ...keys.map((k) => groups.get(k)!.ids.flatMap((id) => tokens(byId.get(id)!.text).map((t) => t.stem))),
      ...units2.map((u) => u.pile.flatMap((p) => tokens(p.text).map((t) => t.stem))),
    ];
    const { vecs } = tfidf(docs);
    const groupVecs = keys.map((_, i) => centroid([vecs[i]]));
    units2.forEach((u, ui) => {
      const v = vecs[keys.length + ui];
      let bi = -1;
      let bv = 0.12;
      groupVecs.forEach((gv, gi) => {
        const c = cosine(v, gv);
        if (c > bv) [bv, bi] = [c, gi];
      });
      if (bi >= 0) groups.get(keys[bi])!.ids.push(...u.pile.map((p) => p.id));
      else if (u.photo) {
        const heading = mostCommon(u.pile.map((p) => p.heading ?? "").filter(Boolean));
        const d = new Date(u.pile[0].createdAt ?? Date.now());
        const title = heading ?? `Notes, ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
        u.pile.forEach((p) => add(`p:${u.pile[0].id}`, p.id, title));
      } else add("unsorted", u.pile[0].id, UNSORTED);
    });
  }

  const out: SuggestedGroup[] = [];
  for (const [key, g] of groups) {
    const ids = g.ids.map((id) => byId.get(id)!);
    out.push({
      key,
      title: key === "unsorted" ? UNSORTED : mostCommon(g.titles) ?? UNSORTED,
      author: mostCommon(g.authors),
      pageIds: g.ids,
      type: guessType(ids, g.course ?? false),
    });
  }
  return out.sort((a, b) => (a.key === "unsorted" ? 1 : b.key === "unsorted" ? -1 : b.pageIds.length - a.pageIds.length));
}

/** Project type guess (spec 8.3.5). */
export function guessType(pages: GroupPage[], course = false): ProjectType {
  if (course || pages.some((p) => findCourseCode([p.sourceName ?? "", p.heading ?? "", p.text.slice(0, 300)].join("\n")))) return "class";
  const files = pages.filter((p) => p.kind && FILE_KINDS.has(p.kind));
  if (pages.some((p) => p.kind === "slides") || files.some((p) => LECTURE_NAME.test(p.sourceName ?? ""))) return "class";
  const bookish = pages.filter((p) => p.kind === "screenshot" || p.verbatim || (p.kind === "note" && p.suggestedAuthor)).length;
  if (bookish && bookish >= pages.length / 2) return "book";
  if (!pages.some((p) => p.kind) && pages.length) return "book";
  return "other";
}

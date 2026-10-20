// Offline grouping of inbox pages into suggested projects (spec 3.3, extended by 8.3 and 9.5).
import { categorize, lexiconCategory, sharedFolder } from "./categories";
import { cleanFileTitle } from "./formats";
import { authorsConflict, titlesMatch } from "./identity";
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
  folder?: string;
  noteId?: string;
  words?: { term: string; definition?: string }[];
  pageNumber?: number;
};
export type SuggestedGroup = { key: string; title: string; author?: string; pageIds: string[]; type?: ProjectType; category?: string };

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
export const LOOSE_NOTES = "Loose notes";
/** The one group every word list goes into (spec 10.2). */
export const WORDS_TITLE = "Words";
export const WORDS_CATEGORY = "Vocabulary";
export const COURSE_CODE = /\b([A-Z]{2,5})\s?-?(\d{2,4}[A-Z]?)\b/g;
const FILE_KINDS = new Set<PageKind>(["pdf", "slides", "doc"]);
const LECTURE_NAME = /\b(lecture|lec\s?\d|week\s?\d|slides|syllabus|midterm|final exam|seminar|tutorial|lab\s?\d)\b/i;
const THREE_HOURS = 3 * 3600 * 1000;
/** Words that name a session, not the course ("BIO 101 Lecture 5" is titled "BIO 101"). */
const SESSION_WORD = /^(lecture|lec|week|wk|notes?|slides?|lab|chapter|ch|unit|session|part|midterm|final|exam|quiz|hw|homework)$/i;
const NOT_CODES = new Set(["ISBN", "PAGE", "FIG", "TABLE", "COVID", "MP", "PM", "AM", "ID", "PDF", "USB", "UTC", "GMT"]);

/** First course code in a text, normalized to "BIO 101", with the words that follow it. */
export function findCourseCode(text: string): { code: string; following?: string } | null {
  for (const m of text.matchAll(COURSE_CODE)) {
    if (NOT_CODES.has(m[1])) continue;
    const code = `${m[1]} ${m[2]}`;
    const after = text.slice((m.index ?? 0) + m[0].length).split("\n")[0];
    // Capitalized words, up to 4; a session word stops the name, and a word with trailing punctuation ends it.
    const name: string[] = [];
    for (const raw of after.replace(/^[\s:\-\u2013|,.]+/, "").split(/\s+/).filter(Boolean).slice(0, 4)) {
      const w = raw.replace(/[,.:;]+$/, "");
      if (!/^[A-Z&][\p{L}&'-]*$/u.test(w) || SESSION_WORD.test(w)) break;
      name.push(w);
      if (w !== raw) break;
    }
    const following = name.join(" ");
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

/** Note title cleaned like a file name, plus "Notes on X", "X summary", dates and "X by Author" (9.5.1). */
export function cleanNoteTitle(raw: string): { title: string; author?: string } {
  let t = raw.replace(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:notes on|notes from|summary of|thoughts on)\s+/i, "").replace(/\s+(?:notes|summary)$/i, "");
  t = cleanFileTitle(t).replace(/[\s\-:.,]+$/, "") || raw.trim();
  const m = /^(.+?)\s+by\s+([A-Z][\p{L}.'-]*(?:\s+[A-Z][\p{L}.'-]*){0,3})$/u.exec(t);
  return m ? { title: m[1].trim(), author: m[2].trim() } : { title: t };
}

type G = { titles: string[]; authors: string[]; ids: string[]; course?: boolean; book?: boolean; category?: string; units?: number; type?: ProjectType };
const SMALL_NOTE_PAGES = 4;
const ATTACH_COSINE = 0.2;

export function groupPages(pages: GroupPage[]): SuggestedGroup[] {
  const groups = new Map<string, G>();
  const byId = new Map(pages.map((p) => [p.id, p]));
  const add = (key: string, id: string, title: string, author?: string, course = false, book = false) => {
    const g = groups.get(key) ?? { titles: [], authors: [], ids: [] };
    g.titles.push(title);
    if (author) g.authors.push(author);
    g.ids.push(id);
    if (course) g.course = true;
    if (book) g.book = true;
    groups.set(key, g);
  };
  const noteUnitIds = new Set<string>();

  // 1. suggestedTitle wins (Books footer, user edits on Sort).
  let rest: GroupPage[] = [];
  for (const p of pages) {
    const k = titleKey(p.suggestedTitle);
    if (!k && p.words?.length) {
      add("w:words", p.id, WORDS_TITLE);
      continue;
    }
    if (k === "unsorted") add("unsorted", p.id, UNSORTED);
    else if (k) add("t:" + k, p.id, p.suggestedTitle!.trim(), p.suggestedAuthor);
    else rest.push(p);
  }

  // 2-3. Files (PDF, slides, docs) and Apple Notes are units. Course codes on a unit's first 2 pages join units.
  const files = new Map<string, GroupPage[]>();
  const loose: GroupPage[] = [];
  for (const p of rest) {
    const isNote = !!p.noteId;
    if (isNote || (p.sourceName && p.kind && FILE_KINDS.has(p.kind))) {
      const key = isNote ? "n:" + p.noteId : "f:" + p.sourceName;
      const f = files.get(key) ?? [];
      f.push(p);
      files.set(key, f);
      if (isNote) noteUnitIds.add(p.id);
    } else loose.push(p);
  }
  const units: { name: string; title: string; author?: string; ids: string[] }[] = [];
  for (const fp of files.values()) {
    const name = fp[0].sourceName ?? "";
    fp.sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
    const firstTwo = fp.slice(0, 2).map((p) => [p.heading ?? "", p.text].join("\n")).join("\n");
    const cc = findCourseCode([name, firstTwo].join("\n"));
    if (cc) {
      const key = "c:" + cc.code.replace(/\s/g, "").toLowerCase();
      fp.forEach((p) => add(key, p.id, cc.following ? `${cc.code}: ${cc.following}` : cc.code, undefined, true));
      continue;
    }
    if (fp[0].noteId) {
      const t = cleanNoteTitle(name || fp[0].heading || "Note");
      units.push({ name, title: t.title, author: t.author, ids: fp.map((p) => p.id) });
      continue;
    }
    const title = fp[0].sourceTitle?.trim() || fp[0].heading?.trim() || cleanFileTitle(name);
    units.push({ name, title, ids: fp.map((p) => p.id) });
  }
  // Merge units whose titles overlap (union in import order).
  const merged: { title: string; author?: string; ids: string[]; titles: string[] }[] = [];
  for (const u of units) {
    const hit = merged.find((m) => m.titles.some((t) => titlesOverlap(t, u.title)));
    if (hit) {
      hit.ids.push(...u.ids);
      hit.titles.push(u.title);
      hit.author ??= u.author;
    } else merged.push({ title: u.title, author: u.author, ids: [...u.ids], titles: [u.title] });
  }
  for (const m of merged) {
    const key = "t:" + titleKey(m.title);
    m.ids.forEach((id) => add(key, id, m.title, m.author, false, !!m.author));
    const g = groups.get(key)!;
    g.units = (g.units ?? 0) + m.titles.length;
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

  mergeSameBooks(groups);
  attachSmallNoteGroups(groups, byId, noteUnitIds);

  const out: SuggestedGroup[] = [];
  for (const [key, g] of groups) {
    const ids = g.ids.map((id) => byId.get(id)!);
    const title = key === "unsorted" ? UNSORTED : mostCommon(g.titles) ?? UNSORTED;
    const wordList = ids.length > 0 && ids.every((p) => p.words?.length);
    if (wordList) {
      g.type = "other";
      g.category ??= WORDS_CATEGORY;
    }
    const type = g.type ?? (g.book ? "book" : guessType(ids, g.course ?? false));
    out.push({
      key,
      title,
      author: mostCommon(g.authors),
      pageIds: orderByPageNumber(ids).map((p) => p.id),
      type,
      category: g.category ?? categorize({ title: key === "unsorted" ? "" : title, type, pages: ids }),
    });
  }
  return out.sort((a, b) => (a.key === "unsorted" ? 1 : b.key === "unsorted" ? -1 : b.pageIds.length - a.pageIds.length));
}

/**
 * Spec 10.4: title groups that name the same book ("Sapiens" and "Sapiens: A Brief History") merge.
 * Course groups, Words, Unsorted and photo piles never merge; conflicting authors block a merge.
 */
function mergeSameBooks(groups: Map<string, G>) {
  const keys = [...groups.keys()].filter((k) => k.startsWith("t:") && k !== "t:words");
  const gone = new Set<string>();
  for (let i = 0; i < keys.length; i++) {
    if (gone.has(keys[i])) continue;
    const a = groups.get(keys[i])!;
    for (let j = i + 1; j < keys.length; j++) {
      if (gone.has(keys[j])) continue;
      const b = groups.get(keys[j])!;
      const ta = mostCommon(a.titles) ?? "";
      const tb = mostCommon(b.titles) ?? "";
      if (!titlesMatch(ta, tb) || authorsConflict(mostCommon(a.authors), mostCommon(b.authors))) continue;
      const keep = a.ids.length > b.ids.length || (a.ids.length === b.ids.length && ta.length <= tb.length) ? ta : tb;
      const author = a.authors[0] ?? b.authors[0];
      a.ids.push(...b.ids);
      a.titles = a.ids.map(() => keep);
      a.authors = author ? [author] : [];
      a.book = a.book || b.book;
      a.units = (a.units ?? 0) + (b.units ?? 0) || undefined;
      groups.delete(keys[j]);
      gone.add(keys[j]);
    }
  }
}

/** Spec 10.5: when most screenshots carry a page number, read them in page order (numberless pages last). */
export function orderByPageNumber<T extends { kind?: string; pageNumber?: number; createdAt?: string }>(pages: T[]): T[] {
  const shots = pages.filter((p) => p.kind === "screenshot");
  if (!shots.length || shots.filter((p) => p.pageNumber).length * 2 < shots.length) return pages;
  const numbered = pages
    .filter((p) => p.pageNumber)
    .sort((a, b) => a.pageNumber! - b.pageNumber! || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  return [...numbered, ...pages.filter((p) => !p.pageNumber)];
}

function groupText(g: G, byId: Map<string, GroupPage>): string {
  return [mostCommon(g.titles) ?? "", ...g.ids.map((id) => byId.get(id)!.text)].join("\n");
}

/**
 * Spec 9.5.3-4: a lone note (one note unit, < 4 pages, no author) joins the most similar group of >= 4
 * pages (cosine >= 0.2), else is bucketed by shared folder, then lexicon category, else "Loose notes".
 */
function attachSmallNoteGroups(groups: Map<string, G>, byId: Map<string, GroupPage>, noteUnitIds: Set<string>) {
  const keys = [...groups.keys()].filter((k) => k !== "unsorted");
  const small = keys.filter((k) => {
    const g = groups.get(k)!;
    return g.units === 1 && !g.book && !g.course && g.ids.length < SMALL_NOTE_PAGES && g.ids.every((id) => noteUnitIds.has(id));
  });
  if (!small.length) return;
  const big = keys.filter((k) => k !== "w:words" && groups.get(k)!.ids.length >= SMALL_NOTE_PAGES);
  const docs = [...big, ...small].map((k) => tokens(groupText(groups.get(k)!, byId)).map((t) => t.stem));
  const { vecs } = tfidf(docs);
  const buckets = new Map<string, G>();
  small.forEach((k, si) => {
    const g = groups.get(k)!;
    const v = vecs[big.length + si];
    let bi = -1;
    let bv = ATTACH_COSINE - 1e-9;
    big.forEach((_, i) => {
      const c = cosine(v, vecs[i]);
      if (c > bv) [bv, bi] = [c, i];
    });
    groups.delete(k);
    if (bi >= 0) {
      groups.get(big[bi])!.ids.push(...g.ids);
      return;
    }
    const pages = g.ids.map((id) => byId.get(id)!);
    const folder = sharedFolder(pages);
    const cat = folder ? undefined : lexiconCategory(groupText(g, byId));
    const bkey = folder ? "f:" + folder.toLowerCase() : cat ? "k:" + cat : "loose";
    const title = folder ?? (cat ? `${cat} notes` : LOOSE_NOTES);
    const b = buckets.get(bkey) ?? { titles: [title], authors: [], ids: [], category: cat };
    b.ids.push(...g.ids);
    buckets.set(bkey, b);
  });
  for (const [k, b] of buckets) groups.set("b" + k, b);
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

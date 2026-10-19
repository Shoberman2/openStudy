// Lessons for class material and definition cards (spec 8.4).
import {
  absorbSmall,
  buildOffline,
  clozeDraft,
  kmeans,
  pickClozes,
  projectTerms,
  quoteCandidates,
  surfaceMap,
  themeTitle,
  type BuildPage,
  type BuildResult,
  type FactDraft,
  type LessonDraft,
  type Sent,
} from "./builder";
import { cleanFileTitle } from "./formats";
import { centroid, cosine, tfidf } from "./tfidf";
import { normalizeForDedupe, splitSentences, tokens, truncate, wordCount } from "./text";
import type { PageKind, ProjectType } from "./types";
import { clamp } from "./util";

export type ClassPage = BuildPage & { kind?: PageKind; sourceName?: string; sourceIndex?: number; sourceTitle?: string; heading?: string; createdAt?: string };

const BULLET_KINDS = new Set<PageKind>(["slides", "doc", "photo", "pdf"]);

// ---------- definitions ----------

export type Definition = { term: string; definition: string };

const NOT_TERMS = new Set([
  "it", "this", "that", "there", "here", "he", "she", "they", "we", "you", "i", "what", "which", "who", "these", "those",
  "one", "all", "each", "every", "some", "everything", "nothing", "something", "life", "today", "now", "note", "example",
  "answer", "question", "remember", "so", "but", "and", "if", "when", "the", "a", "an",
]);

function cleanTerm(t: string): string | null {
  const term = t.trim().replace(/^[-*•\d.)\s]+/, "").replace(/^(the|a|an)\s+/i, "").replace(/[\s,;]+$/, "");
  const ws = term.split(/\s+/).filter(Boolean);
  if (!ws.length || ws.length > 5) return null;
  if (NOT_TERMS.has(ws[0].toLowerCase())) return null;
  if (!/^[\p{L}]/u.test(term) || /[.!?]/.test(term)) return null;
  return term.charAt(0).toUpperCase() + term.slice(1);
}

function cleanDef(d: string): string | null {
  const def = d.trim().replace(/^[-:=\s]+/, "").replace(/[.;\s]+$/, "");
  const n = wordCount(def);
  if (n < 4 || n > 40) return null;
  return def;
}

/**
 * Detect "Term: definition", "Term - definition", "Term = definition",
 * "Term is/are/means/refers to definition", "Term (abbr) is ..." (term 1..5 words, definition 4..40 words).
 */
export function detectDefinition(line: string): Definition | null {
  const s = line.trim();
  const sep = s.match(/^([^:=\u2013\u2014]{1,60}?)\s*(?::|=|\s[-\u2013\u2014]\s)\s*(.+)$/);
  if (sep) {
    const term = cleanTerm(sep[1]);
    const def = cleanDef(sep[2]);
    if (term && def) return { term, definition: def };
  }
  const verb = s.match(/^((?:[\p{L}][\p{L}'-]*\s+){0,4}[\p{L}][\p{L}'-]*)(\s*\([^)]{1,20}\))?\s+(is|are|means|refers to)\s+(.+)$/iu);
  if (verb) {
    const term = cleanTerm(verb[1]);
    const def = cleanDef(verb[4]);
    // "is" sentences need a definitional opener to avoid "Life is long enough".
    if (term && def && /^(a|an|the|any|one|when|how|what|where|process|study|movement|ability)\b/i.test(def)) return { term, definition: def };
  }
  return null;
}

function defCards(defs: { d: Definition; s: Sent }[], allTerms: string[]): FactDraft[] {
  return defs.map(({ d, s }) => {
    const others = allTerms
      .filter((t) => t.toLowerCase() !== d.term.toLowerCase())
      .sort((a, b) => Math.abs(a.length - d.term.length) - Math.abs(b.length - d.term.length) || a.localeCompare(b))
      .slice(0, 3);
    const defLower = /^[A-Z][a-z]/.test(d.definition) ? d.definition.charAt(0).toLowerCase() + d.definition.slice(1) : d.definition;
    const definition = d.definition.charAt(0).toUpperCase() + d.definition.slice(1);
    return {
      pageId: s.pageId,
      term: d.term,
      definition,
      statement: `${d.term}: ${defLower}.`,
      cloze: d.term,
      question: `What is ${/^[A-Z]{2,}/.test(d.term) ? d.term : d.term.charAt(0).toLowerCase() + d.term.slice(1)}?`,
      answer: d.term,
      distractors: others,
      falseStatement: others[0] ? `${others[0]}: ${defLower}.` : `${d.term}: ${defLower}.`,
    };
  });
}

// ---------- sentences ----------

/** Sentences for class pages: every line of >= 4 words counts, even without a period. */
function classSentences(pages: ClassPage[]): Omit<Sent, "vec">[] {
  const out: Omit<Sent, "vec">[] = [];
  const seen = new Set<string>();
  let order = 0;
  for (const p of pages) {
    const bullets = !p.kind || BULLET_KINDS.has(p.kind);
    const lines = bullets ? p.text.split(/\n+/) : [p.text];
    for (const line of lines) {
      for (const s of splitSentences(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""))) {
        const n = wordCount(s);
        if (n < (bullets ? 4 : 7) || n > 45) continue;
        const key = normalizeForDedupe(s);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ text: s, pageId: p.id, header: p.heading ?? p.header, toks: tokens(s), order: order++ });
      }
    }
  }
  return out;
}

// ---------- lesson units ----------

type Unit = { title?: string; sents: Sent[] };

function fileNumber(name: string): number | null {
  const m = name.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** "Lecture 4: Enzymes" -> "Enzymes". */
export function lessonTitleFromFile(title: string): string {
  // Course codes belong to the project title, not to each lesson.
  const noCode = title.replace(/\b[A-Z]{2,5}\s?-?\d{2,4}[A-Z]?\b/g, " ");
  const t = cleanFileTitle(/\.[a-z0-9]{2,5}$/i.test(noCode) ? noCode : noCode + ".x");
  return t || cleanFileTitle(title + ".x");
}

/** Group a file's sentences by heading: merge consecutive equal headings, sections < 3 sentences join the previous. */
function byHeadings(sents: Sent[]): Unit[] {
  const units: Unit[] = [];
  for (const s of sents) {
    const h = s.header?.trim();
    const last = units[units.length - 1];
    if (last && (last.title ?? "") === (h ?? "")) last.sents.push(s);
    else units.push({ title: h, sents: [s] });
  }
  const merged: Unit[] = [];
  for (const u of units) {
    const prev = merged[merged.length - 1];
    if (prev && u.sents.length < 3) prev.sents.push(...u.sents);
    else merged.push({ ...u, sents: [...u.sents] });
  }
  if (merged.length > 1 && merged[0].sents.length < 3) {
    merged[1].sents.unshift(...merged[0].sents);
    merged.shift();
  }
  return merged;
}

function kmeansUnits(sents: Sent[]): Unit[] {
  const k = clamp(Math.round(Math.sqrt(sents.length / 5)), 1, 6);
  const assign = kmeans(sents, k);
  const raw: Sent[][] = Array.from({ length: k }, () => []);
  sents.forEach((s, i) => raw[assign[i]].push(s));
  return absorbSmall(raw)
    .map((g) => ({ sents: g.sort((a, b) => a.order - b.order) }))
    .sort((a, b) => a.sents[0].order - b.sents[0].order);
}

export function buildClass(project: { title: string; author?: string; type?: ProjectType }, pages: ClassPage[]): BuildResult {
  const raw = classSentences(pages);
  const quotes = pages.some((p) => p.verbatim) ? quoteCandidates(pages.filter((p) => p.verbatim), project.author) : [];
  if (!raw.length) return { lessons: [], quotes };
  const { vecs } = tfidf(raw.map((s) => s.toks.map((t) => t.stem)));
  const all: Sent[] = raw.map((s, i) => ({ ...s, vec: vecs[i] }));
  const surfaces = surfaceMap(all);
  const pageById = new Map(pages.map((p) => [p.id, p]));

  // Files in order: number in the file name, else import order.
  const fileOrder: string[] = [];
  for (const p of pages) {
    const f = p.sourceName ?? "";
    if (!fileOrder.includes(f)) fileOrder.push(f);
  }
  fileOrder.sort((a, b) => {
    const na = fileNumber(a);
    const nb = fileNumber(b);
    if (na !== null && nb !== null && na !== nb) return na - nb;
    return fileOrder.indexOf(a) - fileOrder.indexOf(b);
  });
  const fileOf = (s: Sent) => pageById.get(s.pageId)?.sourceName ?? "";
  const files = fileOrder.filter((f) => all.some((s) => fileOf(s) === f));

  let units: Unit[] = [];
  if (files.length >= 2) {
    for (const f of files) {
      const sents = all.filter((s) => fileOf(s) === f);
      const first = pages.find((p) => (p.sourceName ?? "") === f);
      // Photos and screenshots are named by what is written on them; files by their title.
      const photoLike = first?.kind === "photo" || first?.kind === "screenshot";
      const named = photoLike && first?.heading ? first.heading : first?.sourceTitle || f;
      const base = f ? lessonTitleFromFile(named).replace(/^\p{Ll}/u, (c) => c.toUpperCase()) : undefined;
      if (sents.length > 30) {
        const parts = byHeadings(sents);
        if (parts.length > 1) {
          units.push(...parts.map((u) => ({ title: base && u.title ? `${base}: ${u.title}` : u.title ?? base, sents: u.sents })));
          continue;
        }
      }
      units.push({ title: base, sents });
    }
  } else {
    const parts = byHeadings(all);
    units = parts.length > 1 && parts.some((u) => u.title) ? parts : kmeansUnits(all);
  }

  const topTerms = projectTerms(all, surfaces);
  // Definitions per unit (first occurrence of a term wins).
  const seenTerms = new Set<string>();
  const unitDefs = units.map((u) => {
    const ds: { d: Definition; s: Sent }[] = [];
    for (const s of u.sents) {
      const d = detectDefinition(s.text);
      if (!d || seenTerms.has(d.term.toLowerCase())) continue;
      seenTerms.add(d.term.toLowerCase());
      ds.push({ d, s });
    }
    return ds.slice(0, 20);
  });
  const allTerms = unitDefs.flat().map((x) => x.d.term);
  const unitClozes = units.map((u, i) => {
    const used = new Set(unitDefs[i].map((x) => x.s));
    return pickClozes(u.sents.filter((s) => !used.has(s)), 24 - unitDefs[i].length);
  });
  const allClozes = [...unitClozes.flat().map((x) => x.cloze), ...allTerms];

  const usedTitles = new Set<string>();
  const lessons: LessonDraft[] = units.map((u, i) => {
    const c = centroid(u.sents.map((s) => s.vec));
    const title0 = u.title?.trim() || themeTitle(u.sents.map((s) => s.text), c, surfaces, usedTitles);
    let title = title0;
    for (let n = 2; usedTitles.has(title); n++) title = `${title0} ${n}`;
    usedTitles.add(title);
    let best = u.sents[0];
    let bv = -1;
    for (const s of u.sents) {
      const v = cosine(s.vec, c);
      if (v > bv) [bv, best] = [v, s];
    }
    const cards = [...defCards(unitDefs[i], allTerms), ...unitClozes[i].map(({ s, cloze }) => clozeDraft(s, cloze, allClozes, topTerms))];
    return { title, summary: truncate(best.text, 120), cards };
  });
  return { lessons: lessons.filter((l) => l.cards.length), quotes };
}

/** Pick the builder for a project (spec 4 for books, 8.4 for class and other material). */
export function buildProject(project: { title: string; author?: string; type?: ProjectType }, pages: ClassPage[]): BuildResult {
  const hasFiles = pages.some((p) => p.kind && p.kind !== "screenshot" && p.kind !== "note");
  if (project.type === "class" || (project.type !== "book" && hasFiles)) return buildClass(project, pages);
  return buildOffline(project, pages);
}


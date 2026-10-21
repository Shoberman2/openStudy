// Offline lesson builder (spec section 4). Deterministic.
import { centroid, cosine, norm, sum, tfidf, type Vec } from "./tfidf";
import { STOPWORDS, containsTerm, normalizeForDedupe, replaceTerm, splitSentences, stem, tokens, truncate, words, wordCount } from "./text";
import { clamp, titleCase } from "./util";

export type BuildPage = { id: string; text: string; header?: string; verbatim?: boolean };

export type FactDraft = {
  pageId?: string;
  term?: string;
  definition?: string;
  statement: string;
  cloze: string;
  question: string;
  answer: string;
  distractors: string[];
  falseStatement: string;
  concept?: string;
};
/** A picture card (spec 11.2): recall a photo or diagram page from its image. */
export type PictureDraft = { pageId: string; statement: string; question: string };
export type LessonDraft = { title: string; summary: string; cards: FactDraft[]; pictures?: PictureDraft[] };
export type QuoteDraft = { pageId?: string; text: string; attribution?: string };
export type BuildResult = { lessons: LessonDraft[]; quotes: QuoteDraft[] };

export type Sent = {
  text: string;
  pageId: string;
  header?: string;
  toks: { stem: string; surface: string }[];
  vec: Vec;
  order: number;
};

const IMPERATIVES = new Set([
  "be", "do", "don't", "never", "always", "remember", "give", "make", "let", "try", "talk", "ask", "begin",
  "avoid", "show", "become", "smile", "listen", "think", "keep", "treat", "choose", "act",
]);
const APHORISM = ["the only way", "is the", "most people", "you can"];

function normHeader(h?: string): string {
  return (h ?? "").toLowerCase().replace(/[\d\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function kmeans(sents: Sent[], k: number, iterations = 12): number[] {
  const n = sents.length;
  if (k <= 1 || n <= k) return sents.map(() => 0);
  // Farthest-first init from the highest-norm sentence.
  let first = 0;
  for (let i = 1; i < n; i++) if (norm(sents[i].vec) > norm(sents[first].vec)) first = i;
  const seeds = [first];
  while (seeds.length < k) {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < n; i++) {
      if (seeds.includes(i)) continue;
      const d = Math.min(...seeds.map((s) => 1 - cosine(sents[i].vec, sents[s].vec)));
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) break;
    seeds.push(best);
  }
  let cents = seeds.map((s) => sents[s].vec);
  let assign = sents.map(() => 0);
  for (let it = 0; it < iterations; it++) {
    assign = sents.map((s) => {
      let bi = 0;
      let bv = -1;
      cents.forEach((c, ci) => {
        const v = cosine(s.vec, c);
        if (v > bv) {
          bv = v;
          bi = ci;
        }
      });
      return bi;
    });
    cents = cents.map((c, ci) => {
      const members = sents.filter((_, i) => assign[i] === ci).map((s) => s.vec);
      return members.length ? centroid(members) : c;
    });
  }
  return assign;
}

/** Merge clusters with < 3 sentences into the nearest remaining cluster. */
export function absorbSmall(groups: Sent[][]): Sent[][] {
  let gs = groups.filter((g) => g.length > 0);
  for (;;) {
    if (gs.length <= 1) return gs;
    const smallIdx = gs.findIndex((g) => g.length < 3);
    if (smallIdx < 0) return gs;
    const small = gs[smallIdx];
    const rest = gs.filter((_, i) => i !== smallIdx);
    const cents = rest.map((g) => centroid(g.map((s) => s.vec)));
    for (const s of small) {
      let bi = 0;
      let bv = -1;
      cents.forEach((c, ci) => {
        const v = cosine(s.vec, c);
        if (v > bv) {
          bv = v;
          bi = ci;
        }
      });
      rest[bi].push(s);
    }
    gs = rest;
  }
}

export function surfaceMap(sents: Sent[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const s of sents)
    for (const t of s.toks) {
      const m = counts.get(t.stem) ?? new Map<string, number>();
      m.set(t.surface, (m.get(t.surface) ?? 0) + 1);
      counts.set(t.stem, m);
    }
  const out = new Map<string, string>();
  for (const [st, m] of counts) {
    let best = "";
    let bc = -1;
    for (const [sf, c] of m) if (c > bc || (c === bc && sf.length < best.length)) [best, bc] = [sf, c];
    out.set(st, best);
  }
  return out;
}

/** Find the exact surface (original casing) of a lowercase word in a sentence. */
export function exactSurface(sentence: string, lower: string): string | null {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\p{L}\\p{N}])`, "iu");
  const m = sentence.match(re);
  return m ? m[1] : null;
}

/** Generic words that make weak lesson titles. Demoted (x0.35), never banned. */
export const WEAK_TITLE_WORDS = new Set([
  "short", "long", "great", "good", "many", "much", "make", "take", "life", "time", "thing", "things", "way",
  "people", "person", "learn", "know", "every", "first", "little", "own", "whole", "day", "new", "old", "big",
  "small", "come", "give", "find", "need", "want", "work", "year", "years", "man", "men", "part", "place", "right",
  "live", "living", "lived", "nothing", "something", "anything", "everything", "hard", "harder", "easy", "best",
  "better", "less", "high", "highest", "same", "other", "able", "use", "used", "say", "see", "keep", "put", "get",
  "seem", "look", "tell", "call", "mean", "become", "went", "came", "thing", "wish", "wished", "one", "two", "three", "lot", "lots", "kind", "sort", "bit", "given", "gave", "made", "taken", "done", "said",
]);

const isWeak = (w: string) => WEAK_TITLE_WORDS.has(w.toLowerCase()) || WEAK_TITLE_WORDS.has(stem(w.toLowerCase()));

/**
 * Lesson title for a theme cluster (spec 4.5):
 * 1. The adjacent two-word phrase (neither a stopword, both >= 3 letters, not both weak) found in the most
 *    distinct sentences, if that count is >= 2. Ties: higher summed centroid weight, then first occurrence.
 * 2. Else the top two centroid terms after demoting weak words, as "A & B" (the second term may not share
 *    its first 4 letters with the first, e.g. not "Waste & Wasteful").
 * Title Case either way; skips a candidate whose title is already used in the project.
 */
export function themeTitle(sentences: string[], centroidVec: Vec, surfaces: Map<string, string>, used: Set<string> = new Set()): string {
  const pairs = new Map<string, { n: number; first: number; a: string; b: string }>();
  let pos = 0;
  sentences.forEach((sent) => {
    const ws = words(sent).map((w) => w.replace(/'s$/, ""));
    const seen = new Set<string>();
    for (let i = 0; i + 1 < ws.length; i++) {
      const a = ws[i];
      const b = ws[i + 1];
      if (a.length < 3 || b.length < 3 || STOPWORDS.has(a) || STOPWORDS.has(b) || /\d/.test(a + b)) continue;
      if (isWeak(a) && isWeak(b)) continue;
      const key = `${a} ${b}`;
      const e = pairs.get(key) ?? { n: 0, first: pos + i, a, b };
      if (!seen.has(key)) {
        e.n++;
        seen.add(key);
      }
      pairs.set(key, e);
    }
    pos += ws.length;
  });
  const weight = (w: string) => centroidVec.get(stem(w)) ?? 0;
  const phrases = [...pairs.entries()]
    .filter(([, e]) => e.n >= 2)
    .sort(([, x], [, y]) => y.n - x.n || weight(y.a) + weight(y.b) - (weight(x.a) + weight(x.b)) || x.first - y.first);
  for (const [key] of phrases) {
    const t = titleCase(key);
    if (!used.has(t)) return t;
  }
  const terms = [...centroidVec.entries()]
    .map(([st, w]) => ({ word: surfaces.get(st) ?? st, score: w * (isWeak(surfaces.get(st) ?? st) ? 0.35 : 1) }))
    .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
    .map((x) => x.word);
  const pick: string[] = [];
  for (const t of terms) {
    if (pick.length === 2) break;
    const sameRoot = pick.length === 1 && pick[0].slice(0, 4).toLowerCase() === t.slice(0, 4).toLowerCase();
    if (!pick.includes(t) && !sameRoot) pick.push(t);
    if (pick.length === 2 && used.has(titleCase(pick.join(" & ")))) pick.pop();
  }
  return titleCase(pick.join(" & ")) || "Key Ideas";
}

/** Rough word-shape class so distractors read grammatically in place of the cloze. */
export function shapeClass(w: string): string {
  const x = w.toLowerCase();
  if (/ly$/.test(x)) return "ly";
  if (/ing$/.test(x)) return "ing";
  if (/ed$/.test(x)) return "ed";
  if (/(tion|sion|ment|ness|ity|ance|ence|ship)s?$/.test(x)) return "noun";
  if (/(ous|ful|ive|able|ible|ical|less|ent|ant)$/.test(x)) return "adj";
  if (/[^s]s$/.test(x)) return "s";
  return "other";
}

export function quoteCandidates(pages: BuildPage[], attribution?: string, max = 20): QuoteDraft[] {
  const out: QuoteDraft[] = [];
  const seen = new Set<string>();
  const push = (pageId: string, text: string) => {
    const t = text.trim().replace(/^["“‘']+|["”’']+$/g, "").trim();
    const key = normalizeForDedupe(t);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ pageId, text: t, attribution });
  };
  // 1. Verbatim Notes excerpts.
  for (const p of pages) if (p.verbatim && wordCount(p.text) <= 60 && wordCount(p.text) >= 4) push(p.id, p.text);
  // 2. Text inside quotation marks.
  for (const p of pages) {
    const re = /[“"]([^”"]+)[”"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(p.text))) {
      const n = wordCount(m[1]);
      if (n >= 6 && n <= 50) push(p.id, m[1]);
    }
  }
  // 3. Imperatives and aphorisms.
  for (const p of pages) {
    for (const s of splitSentences(p.text)) {
      const n = wordCount(s);
      if (n < 6 || n > 30) continue;
      const first = (words(s)[0] ?? "").replace(/'s$/, "");
      const lower = s.toLowerCase();
      if (IMPERATIVES.has(first) || APHORISM.some((a) => lower.includes(a))) push(p.id, s);
    }
  }
  return out.slice(0, max);
}

/** Project-wide high-weight terms (surface forms), used as distractor fallback. */
export function projectTerms(all: Sent[], surfaces: Map<string, string>): string[] {
  const w = new Map<string, number>();
  for (const s of all) for (const [t, x] of s.vec) w.set(t, (w.get(t) ?? 0) + x);
  return [...w.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => surfaces.get(t) ?? t)
    .filter((x) => x.length >= 4);
}

/** Highest TF-IDF-sum sentences, each with its best cloze word (spec 4.6). Returned in reading order. */
export function pickClozes(sents: Sent[], max: number): { s: Sent; cloze: string }[] {
  const ranked = sents.slice().sort((a, b) => sum(b.vec) - sum(a.vec) || a.order - b.order);
  const picks: { s: Sent; cloze: string }[] = [];
  for (const s of ranked) {
    if (picks.length >= max) break;
    const cands = s.toks
      .filter((tk) => tk.surface.length >= 4)
      .map((tk, i) => ({ tk, w: (s.vec.get(tk.stem) ?? 0) * (i === 0 && s.text.toLowerCase().startsWith(tk.surface) ? 0.6 : 1) }))
      .sort((a, b) => b.w - a.w);
    let cloze: string | null = null;
    for (const { tk } of cands) {
      cloze = exactSurface(s.text, tk.surface);
      if (cloze) break;
    }
    if (cloze) picks.push({ s, cloze });
  }
  return picks.sort((a, b) => a.s.order - b.s.order);
}

export function clozeDraft(s: Sent, cloze: string, allClozes: string[], topProjectTerms: string[]): FactDraft {
  const lower = cloze.toLowerCase();
  const fromCards = [...new Set(allClozes.map((c) => c.toLowerCase()))]
    .filter((c) => c !== lower && !containsTerm(s.text, c))
    .sort(
      (a, b) =>
        Number(shapeClass(b) === shapeClass(lower)) - Number(shapeClass(a) === shapeClass(lower)) ||
        Math.abs(a.length - lower.length) - Math.abs(b.length - lower.length) ||
        a.localeCompare(b),
    );
  const distractors: string[] = fromCards.slice(0, 3);
  for (const t of topProjectTerms) {
    if (distractors.length >= 3) break;
    const tl = t.toLowerCase();
    if (tl !== lower && !distractors.includes(tl) && !containsTerm(s.text, tl)) distractors.push(tl);
  }
  const question = replaceTerm(s.text, cloze, "____");
  const atStart = s.text.replace(/^["\u201c'(]+/, "").startsWith(cloze);
  const answer = atStart ? cloze.toLowerCase() : cloze;
  return {
    pageId: s.pageId,
    statement: s.text,
    cloze,
    question,
    answer,
    distractors,
    falseStatement: distractors[0] ? replaceTerm(s.text, cloze, distractors[0]) : s.text,
  };
}

export function buildOffline(project: { title: string; author?: string }, pages: BuildPage[]): BuildResult {
  // 1. Sentences.
  const sents: Omit<Sent, "vec">[] = [];
  const seen = new Set<string>();
  let order = 0;
  for (const p of pages) {
    for (const s of splitSentences(p.text)) {
      const n = wordCount(s);
      if (n < 7 || n > 45) continue;
      const key = normalizeForDedupe(s);
      if (seen.has(key)) continue;
      seen.add(key);
      sents.push({ text: s, pageId: p.id, header: p.header, toks: tokens(s), order: order++ });
    }
  }
  const quotes = quoteCandidates(pages, project.author);
  if (!sents.length) return { lessons: [], quotes };

  // 2-3. Tokens + TF-IDF.
  const { vecs } = tfidf(sents.map((s) => s.toks.map((t) => t.stem)));
  const all: Sent[] = sents.map((s, i) => ({ ...s, vec: vecs[i] }));
  const surfaces = surfaceMap(all);

  // 4. Themes.
  // Headers that are just the book title (Apple Books shows it on alternate pages) are not chapters.
  const titleKey = normHeader(project.title);
  const headerCounts = new Map<string, { raw: string; n: number }>();
  for (const s of all) {
    const h = normHeader(s.header);
    if (!h || h === titleKey) continue;
    const e = headerCounts.get(h) ?? { raw: s.header!.trim(), n: 0 };
    e.n++;
    headerCounts.set(h, e);
  }
  const chapterHeaders = [...headerCounts.entries()].filter(([, e]) => e.n >= 3);
  let groups: { title?: string; sents: Sent[] }[];
  if (chapterHeaders.length >= 2) {
    const byHeader = new Map<string, Sent[]>(chapterHeaders.map(([h]) => [h, []]));
    const orphans: Sent[] = [];
    for (const s of all) {
      const g = byHeader.get(normHeader(s.header));
      if (g) g.push(s);
      else orphans.push(s);
    }
    const keys = [...byHeader.keys()];
    const cents = keys.map((k) => centroid(byHeader.get(k)!.map((s) => s.vec)));
    for (const s of orphans) {
      let bi = 0;
      let bv = -1;
      cents.forEach((c, ci) => {
        const v = cosine(s.vec, c);
        if (v > bv) [bv, bi] = [v, ci];
      });
      byHeader.get(keys[bi])!.push(s);
    }
    groups = keys.map((k) => ({ title: titleCase(headerCounts.get(k)!.raw), sents: byHeader.get(k)! }));
  } else {
    const k = clamp(Math.round(Math.sqrt(all.length / 5)), 1, 6);
    const assign = kmeans(all, k);
    const raw: Sent[][] = Array.from({ length: k }, () => []);
    all.forEach((s, i) => raw[assign[i]].push(s));
    groups = absorbSmall(raw).map((g) => ({ sents: g }));
  }
  for (const g of groups) g.sents.sort((a, b) => a.order - b.order);
  groups.sort((a, b) => a.sents[0].order - b.sents[0].order);

  const topProjectTerms = projectTerms(all, surfaces);

  // 5-6. Titles, summaries, cards.
  const usedTitles = new Set<string>();
  type Pre = { title: string; summary: string; picks: { s: Sent; cloze: string }[] };
  const pre: Pre[] = groups.map((g) => {
    const c = centroid(g.sents.map((s) => s.vec));
    let title = g.title;
    if (!title) title = themeTitle(g.sents.map((x) => x.text), c, surfaces, usedTitles);
    let t = title;
    for (let i = 2; usedTitles.has(t); i++) t = `${title} ${i}`;
    usedTitles.add(t);
    let best = g.sents[0];
    let bv = -1;
    for (const s of g.sents) {
      const v = cosine(s.vec, c);
      if (v > bv) [bv, best] = [v, s];
    }
    const picks = pickClozes(g.sents, 14);
    return { title: t, summary: truncate(best.text, 120), picks };
  });

  const allClozes = pre.flatMap((l) => l.picks.map((p) => p.cloze));
  const lessons: LessonDraft[] = pre.map((l) => ({
    title: l.title,
    summary: l.summary,
    cards: l.picks.map(({ s, cloze }) => clozeDraft(s, cloze, allClozes, topProjectTerms)),
  }));

  return { lessons: lessons.filter((l) => l.cards.length > 0), quotes };
}

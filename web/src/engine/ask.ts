// Ask your notes (spec 10.7): retrieval, the offline answer, and the verbatim check for model citations.
import { cosine, type Vec } from "./tfidf";
import { splitSentences, tokens, truncate, wordCount } from "./text";

export type AskPage = { id: string; text: string };

const normQuote = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

/** `quote` appears in `source` word for word (whitespace and curly quotes aside, case-sensitive). */
export function isVerbatim(quote: string, source: string): boolean {
  const q = normQuote(quote);
  return q.length >= 3 && normQuote(source).includes(q);
}

type Index = { idf: Map<string, number>; n: number };

function index(pages: AskPage[]): { idx: Index; vecs: Vec[] } {
  const docs = pages.map((p) => tokens(p.text).map((t) => t.stem));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log((1 + n) / (1 + c)) + 1);
  const idx = { idf, n };
  return { idx, vecs: docs.map((d) => vectorOf(d, idx)) };
}

/** TF-IDF vector of a token list against the pages' idf (unseen words count as df 0). */
function vectorOf(stems: string[], idx: Index): Vec {
  const tf = new Map<string, number>();
  for (const t of stems) tf.set(t, (tf.get(t) ?? 0) + 1);
  const v: Vec = new Map();
  for (const [t, c] of tf) v.set(t, (c / Math.max(1, stems.length)) * (idx.idf.get(t) ?? Math.log(1 + idx.n) + 1));
  return v;
}

/** Pages ranked by cosine with the question; only score > 0; ties keep page order. */
export function retrieve<P extends AskPage>(question: string, pages: P[], k = 6): { page: P; score: number }[] {
  if (!pages.length) return [];
  const { idx, vecs } = index(pages);
  const q = vectorOf(tokens(question).map((t) => t.stem), idx);
  return pages
    .map((page, i) => ({ page, score: cosine(q, vecs[i]), i }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, k)
    .map(({ page, score }) => ({ page, score }));
}

export type Passage = { pageId: string; text: string };

/** The offline answer: the 3 sentences closest to the question (max 2 per page) from the top pages. */
export function localAnswer(question: string, pages: AskPage[]): Passage[] {
  const top = retrieve(question, pages);
  if (!top.length) return [];
  const { idx } = index(pages);
  const q = vectorOf(tokens(question).map((t) => t.stem), idx);
  const cands: { pageId: string; text: string; score: number; order: number }[] = [];
  let order = 0;
  for (const { page } of top)
    for (const s of splitSentences(page.text.replace(/\n+/g, " "))) {
      const n = wordCount(s);
      if (n < 5 || n > 60) continue;
      cands.push({ pageId: page.id, text: s, score: cosine(q, vectorOf(tokens(s).map((t) => t.stem), idx)), order: order++ });
    }
  cands.sort((a, b) => b.score - a.score || a.order - b.order);
  const out: Passage[] = [];
  const perPage = new Map<string, number>();
  for (const c of cands) {
    if (c.score <= 0 || out.length >= 3) continue;
    const used = perPage.get(c.pageId) ?? 0;
    if (used >= 2) continue;
    perPage.set(c.pageId, used + 1);
    out.push({ pageId: c.pageId, text: c.text });
  }
  // Short bullet notes have no 5+ word sentences: show the best page instead.
  if (!out.length) out.push({ pageId: top[0].page.id, text: truncate(top[0].page.text.replace(/\s+/g, " "), 280) });
  return out;
}

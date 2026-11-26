// "Worth Practicing First" (spec 18): pick the few ideas in a pile of new pages that are worth a first drill.
// Offline and deterministic. Every idea links back to a sentence that can be found on its source page.
import type { FactDraft } from "./builder";
import { buildProject, type ClassPage } from "./classbuilder";
import { isCode } from "./code";
import { centroid, cosine, tfidf, type Vec } from "./tfidf";
import type { ProjectType } from "./types";

export type StudyIdea = {
  key: string;
  /** What to learn: the term, or the key word of a sentence. */
  title: string;
  /** The source sentence it came from. */
  source: string;
  pageId: string;
  score: number;
  /** A typed answer can be asked for it (a term with a definition, or code). */
  typed: boolean;
};

export type ShortlistGroup = { key: string; title: string; author?: string; type: ProjectType; pageIds: string[] };
export type Shortlist = { groupKey: string; ideas: StudyIdea[] };

const WORD = /[a-z][a-z0-9_]+/g;
const STOP = new Set("the a an and or of to in on for is are was were be by with as at it this that from which can its into than then they their there these those has have had not but".split(" "));
const words = (s: string) => (s.toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w));

/** The phrase an idea is about: its term, or the blanked key word. */
function target(d: FactDraft): string {
  return (d.term ?? d.cloze ?? "").trim();
}

/** The sentence on the page an idea came from: it holds the target and the start of the definition or statement. */
export function sourceSentence(text: string, goal: string, d: FactDraft): string | null {
  const code = isCode(goal);
  const has = (s: string, part: string) => (code ? s.includes(part) : s.toLowerCase().includes(part.toLowerCase()));
  const body = (d.definition ?? d.statement.replace(/^[^:]{1,60}:\s*/, "")).replace(/\s+/g, " ").trim();
  const lead = words(body).slice(0, 3);
  const sentences = text.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const s of sentences) {
    if (!has(s, goal)) continue;
    const ws = new Set(words(s));
    if (lead.every((w) => ws.has(w))) return s;
  }
  return null;
}

/** Score the drafts built from one group's pages. Highest first, ties broken by stable source order. */
export function rankStudyIdeas(pages: ClassPage[], drafts: FactDraft[]): StudyIdea[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const pageText = new Map(pages.map((p) => [p.id, p.text.toLowerCase()]));
  const docs = pages.map((p) => words(p.text));
  const { vecs, idf } = tfidf(docs);
  const center = centroid(vecs);
  const vecOf = (s: string): Vec => {
    const v: Vec = new Map();
    for (const w of words(s)) v.set(w, (v.get(w) ?? 0) + (idf.get(w) ?? 0));
    return v;
  };

  const seen = new Set<string>();
  const out: { idea: StudyIdea; order: number }[] = [];
  drafts.forEach((d, order) => {
    const goal = target(d);
    const page = d.pageId ? byId.get(d.pageId) : undefined;
    if (!page || !goal || goal.length > 60) return;
    // Provenance: the idea must come from a sentence on its page, so the learner can check the source.
    const statement = sourceSentence(page.text, goal, d);
    if (!statement) return;
    const key = isCode(goal) ? goal : goal.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const typed = !!(d.term && d.definition) || isCode(goal);
    let score = typed ? 3 : 0;
    if (d.concept) score += 1;
    const lower = goal.toLowerCase();
    if (page.heading?.toLowerCase().includes(lower)) score += 2;
    const pagesWith = pages.filter((p) => (isCode(goal) ? p.text.includes(goal) : pageText.get(p.id)!.includes(lower))).length;
    score += Math.min(3, Math.max(0, pagesWith - 1));
    score += 2 * Math.max(0, cosine(vecOf(statement), center));
    out.push({ idea: { key: `${page.id}:${key}`, title: goal, source: statement, pageId: page.id, score: Math.round(score * 100) / 100, typed }, order });
  });
  return out.sort((a, b) => b.idea.score - a.idea.score || a.order - b.order).map((x) => x.idea);
}

/** Up to `limit` ideas, at most two from one page, so one dense screenshot can't take the whole list. */
export function selectStudyBite(ranked: StudyIdea[], limit = 3): StudyIdea[] {
  const perPage = new Map<string, number>();
  const picked: StudyIdea[] = [];
  for (const idea of ranked) {
    if (picked.length >= limit) break;
    const n = perPage.get(idea.pageId) ?? 0;
    if (n >= 2) continue;
    perPage.set(idea.pageId, n + 1);
    picked.push(idea);
  }
  return picked;
}

/** Pages ranked per group are capped so a huge inbox stays quick to rank. */
export const RANK_PAGE_CAP = 60;

/**
 * The shortlist for an inbox: rank the largest groups and keep the one whose top ideas score best.
 * Only a group with at least one typed idea can start the drill, since typing from memory is the point.
 */
export function buildShortlist(groups: ShortlistGroup[], pagesById: Map<string, ClassPage>, maxGroups = 4): Shortlist | null {
  const candidates = groups
    .filter((g) => g.pageIds.length)
    .slice()
    .sort((a, b) => b.pageIds.length - a.pageIds.length || a.key.localeCompare(b.key))
    .slice(0, maxGroups);
  let best: { list: Shortlist; total: number } | null = null;
  for (const g of candidates) {
    const pages = g.pageIds.slice(0, RANK_PAGE_CAP).map((id) => pagesById.get(id)).filter((p): p is ClassPage => !!p);
    if (!pages.length) continue;
    const drafts = buildProject({ title: g.title, author: g.author, type: g.type }, pages).lessons.flatMap((l) => l.cards);
    const ideas = selectStudyBite(rankStudyIdeas(pages, drafts));
    if (!ideas.some((i) => i.typed)) continue;
    const total = ideas.reduce((s, i) => s + i.score, 0);
    if (!best || total > best.total) best = { list: { groupKey: g.key, ideas }, total };
  }
  return best?.list ?? null;
}

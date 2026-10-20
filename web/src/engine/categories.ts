// Subject categories for projects (spec 9.4). The lexicon lives in shared/categories.json.
import data from "../data/categories.json";
import { findCourseCode } from "./grouping";
import { stem, tokens, words } from "./text";
import type { ProjectType } from "./types";

type Lexicon = { genericFolders: string[]; coursePrefixes: Record<string, string>; categories: { name: string; words: string[] }[] };
const lexicon = data as Lexicon;

const GENERIC = new Set(lexicon.genericFolders.map((f) => f.toLowerCase()));
const CATEGORIES = lexicon.categories.map((c) => ({ name: c.name, stems: new Set(c.words.flatMap((w) => words(w)).map(stem)) }));

export const CATEGORY_NAMES = lexicon.categories.map((c) => c.name);
export const FALLBACK: Record<ProjectType, string> = { book: "Reading", class: "Classes", other: "General" };

export function isGenericFolder(f?: string): boolean {
  const k = (f ?? "").trim().toLowerCase();
  return !k || GENERIC.has(k);
}

/** The non-generic folder shared by >= 60% of the pages, if any. */
export function sharedFolder(pages: { folder?: string }[]): string | undefined {
  if (!pages.length) return undefined;
  const counts = new Map<string, { name: string; n: number }>();
  for (const p of pages) {
    if (isGenericFolder(p.folder)) continue;
    const name = p.folder!.trim();
    const c = counts.get(name.toLowerCase()) ?? { name, n: 0 };
    c.n++;
    counts.set(name.toLowerCase(), c);
  }
  let best: { name: string; n: number } | undefined;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best && best.n >= 0.6 * pages.length ? best.name : undefined;
}

/** Lexicon rule (9.4.3): the subject whose words occur most, when it clears the bar. */
export function lexiconCategory(text: string): string | undefined {
  const toks = tokens(text).map((t) => t.stem);
  if (!toks.length) return undefined;
  let best: { name: string; hits: number } | undefined;
  for (const c of CATEGORIES) {
    let hits = 0;
    const distinct = new Set<string>();
    for (const t of toks)
      if (c.stems.has(t)) {
        hits++;
        distinct.add(t);
      }
    if (distinct.size < 3 || hits < Math.max(4, 0.02 * toks.length)) continue;
    if (!best || hits > best.hits) best = { name: c.name, hits };
  }
  return best?.name;
}

export function coursePrefixCategory(text: string): string | undefined {
  const cc = findCourseCode(text);
  return cc ? lexicon.coursePrefixes[cc.code.split(" ")[0]] : undefined;
}

export type CategorizeInput = { title: string; type?: ProjectType; pages: { text: string; folder?: string; sourceName?: string; heading?: string }[] };

export function categorize(g: CategorizeInput): string {
  const head = [g.title, ...g.pages.slice(0, 2).map((p) => [p.sourceName ?? "", p.heading ?? "", p.text.slice(0, 300)].join("\n"))].join("\n");
  return (
    coursePrefixCategory(head) ??
    sharedFolder(g.pages) ??
    lexiconCategory([g.title, ...g.pages.map((p) => p.text)].join("\n")) ??
    FALLBACK[g.type ?? "book"]
  );
}

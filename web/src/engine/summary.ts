// "What we found" line on the Sort screen (spec 10.6). Idea from BookSaver `detect-summary.ts`.
import { joinAnd } from "./connections";
import { LOOSE_NOTES, UNSORTED, WORDS_TITLE } from "./grouping";
import type { ProjectType } from "./types";

export type SummaryGroup = { title: string; type?: ProjectType; pages: number };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function detectionSummary(groups: SummaryGroup[]): string {
  if (!groups.length) return "Nothing to sort yet.";
  let books = 0;
  let classes = 0;
  let topics = 0;
  let lists = 0;
  let left = 0;
  for (const g of groups) {
    const t = g.title.trim().toLowerCase();
    if (t === UNSORTED.toLowerCase() || t === LOOSE_NOTES.toLowerCase()) left += g.pages;
    else if (t === WORDS_TITLE.toLowerCase()) lists++;
    else if (g.type === "book") books++;
    else if (g.type === "class") classes++;
    else topics++;
  }
  const parts = [
    books ? plural(books, "book", "books") : "",
    classes ? plural(classes, "class", "classes") : "",
    topics ? plural(topics, "topic", "topics") : "",
    lists ? plural(lists, "word list", "word lists") : "",
  ].filter(Boolean);
  const out: string[] = [];
  if (parts.length) out.push(`Looks like ${joinAnd(parts)}.`);
  if (left) out.push(left === 1 ? "1 page still needs a home." : `${left} pages still need a home.`);
  return out.join(" ") || "Nothing to sort yet.";
}

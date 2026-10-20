// Same book, different spelling (spec 10.4). Ported from BookSaver `sort/identity.ts`.
import { levenshtein } from "./check";

/** NFKD, no combining marks, lowercase, non letter/digit runs to one space. */
export function normalizeLookup(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Title without subtitle ("Sapiens: A Brief History" -> "Sapiens"). */
export function baseTitle(raw: string): string {
  const cut = raw.split(/\s*[:|]\s+|\s+[-–—]\s+|\s*\(/)[0] ?? raw;
  return cut.trim() || raw.trim();
}

export function normalizeTitle(raw: string): string {
  return normalizeLookup(raw.replace(/&/g, " and ")).replace(/^(the|a|an)\s+/, "").trim();
}

export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

const digitRuns = (s: string) => (s.match(/\d+/g) ?? []).join(" ");

/** Do two title guesses name the same book? Never when their numbers differ ("BIO 101" vs "BIO 102"). */
export function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (digitRuns(na) !== digitRuns(nb)) return false;
  if (na === nb) return true;
  const ba = normalizeTitle(baseTitle(a));
  const bb = normalizeTitle(baseTitle(b));
  if (ba && ba === bb) return true;
  const ta = na.split(" ");
  const tb = nb.split(" ");
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.join("").length >= 5 && short.every((t, i) => long[i] === t)) return true;
  for (const [x, y] of [
    [na, nb],
    [ba, bb],
  ]) {
    if (x.length >= 6 && y.length >= 6 && similarity(x, y) >= 0.85) return true;
  }
  return false;
}

function normalizeAuthor(raw?: string | null): string {
  return raw ? normalizeLookup(raw.replace(/^\s*by\s+/i, "")) : "";
}

/** "James Clear" vs "Clear, James" vs "J. Clear". */
export function sameAuthor(a?: string | null, b?: string | null): boolean {
  const na = normalizeAuthor(a);
  const nb = normalizeAuthor(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(" ").filter((t) => t.length > 1);
  const tb = nb.split(" ").filter((t) => t.length > 1);
  const lastA = ta[ta.length - 1];
  const lastB = tb[tb.length - 1];
  if ((lastA && tb.includes(lastA)) || (lastB && ta.includes(lastB))) return true;
  return similarity(na, nb) >= 0.85;
}

/** Authors conflict only when both are set and name different people. */
export function authorsConflict(a?: string | null, b?: string | null): boolean {
  return !!normalizeAuthor(a) && !!normalizeAuthor(b) && !sameAuthor(a, b);
}

/** The existing project a group belongs to (Sort "Add to", 9.6 extend). */
export function matchingProject<P extends { title: string; author?: string }>(projects: P[], title: string, author?: string): P | undefined {
  return projects.find((p) => titlesMatch(p.title, title) && !authorsConflict(p.author, author));
}

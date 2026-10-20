// Word lists from Notes, pasted text, text files and photos (spec 10.2). Ported from BookSaver `words.ts`.
import { findCourseCode } from "./grouping";
import { STOPWORDS } from "./text";
import type { WordEntry } from "./types";

export type { WordEntry };
export type WordListParse = { isWordList: boolean; words: WordEntry[] };

const BULLET = /^\s*(?:(?:[-*•·▪◦–—]|\d{1,4}[.)]|\[[ xX]?\])\s+)+/;
const SEPARATOR = /\s+[-–—=]+\s+|\s*:\s+|\s*[–—]\s*|\t+/;
const VOCAB = /\b(words?|vocab(ulary)?|terms?|glossary|definitions?)\b/i;

function cleanTerm(raw: string): string {
  return raw
    .replace(/^["'“‘(]+|["'”’),.;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isTermLike(term: string): boolean {
  if (term.length < 2 || term.length > 48) return false;
  if (term.split(/\s+/).length > 4) return false;
  return /^[\p{L}][\p{L}'’\- ]*$/u.test(term);
}

export function parseWordLine(line: string): WordEntry | null {
  const stripped = line.replace(BULLET, "").trim();
  if (!stripped) return null;
  const parts = stripped.split(SEPARATOR);
  if (parts.length >= 2) {
    const term = cleanTerm(parts[0]);
    const definition = stripped.slice(stripped.indexOf(parts[1], parts[0].length)).trim();
    if (!isTermLike(term)) return null;
    return definition ? { term, definition } : { term };
  }
  const term = cleanTerm(stripped);
  return isTermLike(term) ? { term } : null;
}

/**
 * A definition that wrapped onto the next line (photos and narrow notes): no bullet, no separator,
 * starts lowercase, and has >= 2 words or follows a definition that ends on a stopword ("too eager to" / "please").
 */
function isWrappedLine(line: string, definition: string): boolean {
  if (BULLET.test(line) || SEPARATOR.test(line) || !/^\p{Ll}/u.test(line)) return false;
  const lastWord = definition.split(/\s+/).pop()!.toLowerCase().replace(/[^\p{L}']/gu, "");
  return line.split(/\s+/).length >= 2 || STOPWORDS.has(lastWord);
}

/** Is this text a vocabulary list? `title` is the note title or file name, if any. */
export function parseWordList(text: string, title?: string): WordListParse {
  const no = { isWordList: false, words: [] };
  if (findCourseCode([title ?? "", text].join("\n"))) return no;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let heading: string | undefined;
  const first = lines[0] ?? "";
  if (VOCAB.test(first) && !SEPARATOR.test(first.replace(BULLET, ""))) heading = lines.shift();
  else if (first.split(/\s+/).length >= 2 && /:$/.test(first)) heading = lines.shift();
  const vocabHeading = VOCAB.test(heading ?? "") || VOCAB.test(title ?? "");
  const words: WordEntry[] = [];
  const seen = new Map<string, WordEntry>();
  let entryLines = 0;
  let last: WordEntry | undefined;
  for (const line of lines) {
    if (last?.definition && isWrappedLine(line, last.definition)) {
      last.definition += " " + line;
      entryLines++;
      continue;
    }
    const w = parseWordLine(line);
    last = undefined;
    if (!w) continue;
    entryLines++;
    const k = w.term.toLowerCase();
    const prior = seen.get(k);
    if (prior) {
      if (!prior.definition && w.definition) prior.definition = w.definition;
      last = prior;
      continue;
    }
    seen.set(k, w);
    words.push(w);
    last = w;
  }
  if (words.length < 2 || !lines.length || entryLines / lines.length < 0.7) return no;
  const defined = words.filter((w) => w.definition).length;
  if (defined * 2 < words.length && !vocabHeading) return no;
  return { isWordList: true, words };
}

/** Page text for a word list: its non-empty lines. */
export function wordListText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

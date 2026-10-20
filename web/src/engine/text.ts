// Text primitives shared by the builder, grouping and checking (spec 4.1, 4.2).

export const STOPWORDS = new Set(
  (
    "a about above after again against all am an and any are aren't as at be because been before being below " +
    "between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each " +
    "few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself " +
    "him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't " +
    "my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd " +
    "she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's " +
    "these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll " +
    "we're we've were weren't what what's when when's where where's which while who who's whom why why's will with " +
    "won't would wouldn't you you'd you'll you're you've your yours yourself yourselves also just like get got make " +
    "made many much may might must one ones us yet ever every even still upon shall"
  ).split(/\s+/),
);

const ABBREVIATIONS = ["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "no", "vol", "ch", "fig", "inc", "ltd", "co", "mt"];

/** Lowercase, keep letters/digits/apostrophes. */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:['’][a-z]+)*/g) ?? []).map((w) => w.replace(/’/g, "'"));
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Light stemming: strip trailing s/es/ing/ed when the remainder is >= 4 chars. */
export function stem(w: string): string {
  for (const suf of ["ing", "es", "ed", "s"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 4) return w.slice(0, -suf.length);
  }
  return w;
}

export type Token = { stem: string; surface: string };

/** Content tokens: no stopwords, >= 3 chars, stemmed. */
export function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const raw of words(text)) {
    const w = raw.replace(/'s$/, "");
    if (w.length < 3 || STOPWORDS.has(raw) || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    out.push({ stem: stem(w), surface: w });
  }
  return out;
}

/**
 * Sentence split: `.?!` (optionally followed by closing quotes) then whitespace and a capital
 * or opening quote. Keeps abbreviations like "Mr." "Dr." "e.g." intact.
 */
export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  let start = 0;
  const re = /[.?!]+["'”’)]*(?=\s+["'“‘(]?[A-Z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const end = m.index + m[0].length;
    const before = clean.slice(start, m.index);
    const lastWord = (before.split(/\s+/).pop() ?? "").toLowerCase().replace(/^["'(“]/, "");
    if (m[0].startsWith(".") && (ABBREVIATIONS.includes(lastWord) || /^[a-z]$/.test(lastWord))) continue;
    out.push(clean.slice(start, end).trim());
    start = end;
  }
  const tail = clean.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

export function normalizeForDedupe(s: string): string {
  return words(s).join(" ");
}

/** Answer normalization (spec 5.3). */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|a|an)\s+/, "");
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace the first whole-word occurrence of `term` in `text` (case-insensitive). */
export function replaceTerm(text: string, term: string, replacement: string): string {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(term)})(?![\\p{L}\\p{N}])`, "iu");
  return text.replace(re, (_all, pre: string, found: string) => {
    let rep = replacement;
    if (found[0] && found[0] === found[0].toUpperCase() && found[0] !== found[0].toLowerCase()) {
      rep = rep.charAt(0).toUpperCase() + rep.slice(1);
    }
    return pre + rep;
  });
}

export function containsTerm(text: string, term: string): boolean {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "iu");
  return re.test(text);
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, "") + "…";
}

// Offline concept questions (spec 13.3): turn sentences like "X because Y", "The key to X is Y" or
// "If X, Y" into short questions about the idea instead of a missing word. Deterministic, mirrored on iOS.
import type { BuildResult, FactDraft } from "./builder";
import { STOPWORDS, containsTerm, normalizeAnswer, wordCount } from "./text";

const WHY = /^(.+?),? (because|so that|in order to) (.+)$/i;
const INSTEAD_FIRST = /^Instead of ([^,]+), (.+)$/i;
const INSTEAD = /^(.+?) instead of (.+)$/i;
const IF_WHEN = /^(If|When|Whenever) ([^,]+), (.+)$/i;
const THE_IS = /^(The [^,]+?) (is|are) (.+)$/;
const EFFECT =
  /^(.+?) (leads to|lead to|causes|cause|results in|result in|prevents|prevent|reduces|reduce|increases|increase|improves|improve|depends on|depend on|protects|protect|controls|control) (.+)$/i;
const DEFINE = /^(\p{Lu}[\p{L}'-]*(?: [\p{L}'-]+){0,2}) (is|are) (.+)$/u;
const PRONOUNS = new Set(["it", "this", "that", "these", "those", "they", "he", "she", "which", "who", "what"]);
const THE_IS_STARTS = new Set(["a", "an", "the", "to", "one", "that", "what", "how", "when", "where", "why", "your", "our", "their", "his", "her", "its", "my"]);
const DEFINE_STARTS = new Set(["a", "an", "the", "one", "nothing", "your", "our", "their"]);

export type ConceptMatch = { question: string; answer: string };

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const firstWord = (s: string) => (s.split(/\s+/)[0] ?? "").toLowerCase();
const within = (s: string, lo: number, hi: number) => wordCount(s) >= lo && wordCount(s) <= hi;
/** An answer ends at the first semicolon or ", and" / ", but" / ", which", and drops a trailing comma. */
const answerPart = (s: string) => s.split(/;|, (?:and|but|which) /)[0].trim().replace(/,+$/, "");
/** The subject half never holds a colon: "Term: definition" lines are definition cards. */
const noColon = (a: string) => !a.includes(":");

export function lowerFirst(s: string): string {
  const first = s.split(/\s+/)[0] ?? "";
  const letters = first.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 2 && letters === letters.toUpperCase()) return s;
  if (/\p{Lu}/u.test(letters.slice(1))) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

const startsWithPronoun = (a: string) => PRONOUNS.has(firstWord(a));

type Rule = (s: string) => ConceptMatch | null;

// Tried in this order; the first rule whose checks all pass wins (spec 13.3).
const RULES: Rule[] = [
  (s) => {
    const m = WHY.exec(s);
    if (!m) return null;
    const [a, b] = [m[1].trim(), answerPart(m[3])];
    return !startsWithPronoun(a) && noColon(a) && within(a, 3, 16) && within(b, 2, 14) ? { question: `${a}. Why?`, answer: upperFirst(b) } : null;
  },
  (s) => {
    const m = INSTEAD_FIRST.exec(s);
    if (!m) return null;
    const [x, b] = [m[1].trim(), answerPart(m[2])];
    return within(x, 1, 8) && within(b, 2, 10) ? { question: `What should you do instead of ${x}?`, answer: upperFirst(b) } : null;
  },
  (s) => {
    const m = INSTEAD.exec(s);
    if (!m) return null;
    const [b, x] = [answerPart(m[1]), m[2].trim()];
    const skip = startsWithPronoun(b) || ["the", "a", "an"].includes(firstWord(b));
    return !skip && within(x, 1, 8) && within(b, 2, 10) ? { question: `What should you do instead of ${x}?`, answer: upperFirst(b) } : null;
  },
  (s) => {
    const m = IF_WHEN.exec(s);
    if (!m) return null;
    const [c, b] = [m[2].trim(), answerPart(m[3])];
    return within(c, 2, 12) && within(b, 2, 12) ? { question: `${upperFirst(m[1].toLowerCase())} ${c}, then what?`, answer: upperFirst(b) } : null;
  },
  (s) => {
    const m = THE_IS.exec(s);
    if (!m) return null;
    const [a, b] = [m[1].trim(), answerPart(m[3])];
    return noColon(a) && within(a, 2, 10) && within(b, 2, 12) && THE_IS_STARTS.has(firstWord(b))
      ? { question: `What ${m[2]} ${lowerFirst(a)}?`, answer: upperFirst(b) }
      : null;
  },
  (s) => {
    const m = EFFECT.exec(s);
    if (!m) return null;
    const [a, b] = [m[1].trim(), answerPart(m[3])];
    if (startsWithPronoun(a) || a.includes(",") || !noColon(a) || !within(a, 1, 8) || !within(b, 2, 12)) return null;
    const v = m[2].toLowerCase();
    const [head, ...rest] = v.split(" ");
    const third = head.endsWith("s");
    const base = third ? [head.slice(0, -1), ...rest].join(" ") : v;
    return { question: `What ${third ? "does" : "do"} ${lowerFirst(a)} ${base}?`, answer: upperFirst(b) };
  },
  (s) => {
    const m = DEFINE.exec(s);
    if (!m) return null;
    const [a, b] = [m[1].trim(), answerPart(m[3])];
    return !STOPWORDS.has(firstWord(a)) && within(b, 2, 12) && DEFINE_STARTS.has(firstWord(b))
      ? { question: `What ${m[2]} ${lowerFirst(a)}?`, answer: upperFirst(b) }
      : null;
  },
];

/** The concept question for one statement, or null when no rule fits. */
export function conceptQuestion(statement: string): ConceptMatch | null {
  const s = statement.trim().replace(/[.!?"”’')\],]+$/u, "").trim();
  for (const rule of RULES) {
    const m = rule(s);
    if (m) return m;
  }
  return null;
}

/**
 * Rewrites matching fact cards as concept cards when the project has at least 4 matches, so every
 * one of them can get 3 wrong answers of the same kind.
 */
export function conceptCards(result: BuildResult): BuildResult {
  const found: { li: number; ci: number; m: ConceptMatch }[] = [];
  result.lessons.forEach((l, li) =>
    l.cards.forEach((c, ci) => {
      if (c.term) return;
      const m = conceptQuestion(c.statement);
      if (m) found.push({ li, ci, m });
    }),
  );
  if (found.length < 4) return result;
  const lessons = result.lessons.map((l) => ({ ...l, cards: l.cards.slice() }));
  for (const [i, f] of found.entries()) {
    const card: FactDraft = lessons[f.li].cards[f.ci];
    const own = normalizeAnswer(f.m.answer);
    const len = wordCount(f.m.answer);
    const distractors = found
      .map((o, j) => ({ a: o.m.answer, j }))
      .filter((o) => o.j !== i && normalizeAnswer(o.a) !== own && !containsTerm(card.statement, o.a))
      .sort((x, y) => Math.abs(wordCount(x.a) - len) - Math.abs(wordCount(y.a) - len) || x.j - y.j)
      .reduce<string[]>((acc, o) => (acc.some((a) => normalizeAnswer(a) === normalizeAnswer(o.a)) ? acc : [...acc, o.a]), [])
      .slice(0, 3);
    if (distractors.length < 3) continue;
    lessons[f.li].cards[f.ci] = { ...card, question: f.m.question, answer: f.m.answer, concept: result.lessons[f.li].title, distractors };
  }
  return { ...result, lessons };
}

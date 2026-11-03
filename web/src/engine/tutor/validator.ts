// Deterministic question checks (spec 15.3). Runs on every question, from every source, before any
// model critique and before a learner can see it. Pure and fast.
import { questionSchema, type Question } from "./blocks";

export type IssueCode =
  | "schema"
  | "option_count"
  | "option_ids"
  | "duplicate_options"
  | "correct_count"
  | "missing_explanation"
  | "copied_explanation"
  | "catch_all_option"
  | "answer_in_stem"
  | "word_clue"
  | "explanation_in_stem"
  | "length_balance"
  | "not_a_question"
  | "negative_stem";

export type Issue = { code: IssueCode; detail: string };

/** How many deterministic checks each question goes through; shown on the quiz. */
export const CHECK_COUNT = 14;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");

const STOP = new Set(
  "a an and are as at be because but by can do does for from has have how if in into is it its more less most of on or so than that the their then there these this those to was were what when where which while who why will with would you your".split(" "),
);

const words = (s: string) => norm(s).split(" ").filter((w) => w.length > 3 && !STOP.has(w));
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");

/** Options that let test-taking stand in for understanding. */
const CATCH_ALL = /\b(all|none|both|neither)\s+(of\s+)?(the\s+)?(above|these|those|options|answers)\b|\b(both|either)\s+[a-d]\s+(and|or)\s+[a-d]\b|^[a-d]\s+and\s+[a-d]$/i;

/**
 * The longest option should not stand out. Test-writers pad the right answer with qualifiers, so a long
 * correct option is a clue; short numeric options never trip this.
 */
export const LENGTH_RATIO = 1.75;
const LENGTH_SLACK = 12;

export function validateQuestion(raw: unknown): Issue[] {
  const parsed = questionSchema.safeParse(raw);
  if (!parsed.success) {
    const path = parsed.error.issues[0];
    return [{ code: "schema", detail: `${path?.path.join(".") || "question"}: ${path?.message ?? "invalid"}` }];
  }
  const q: Question = parsed.data;
  const issues: Issue[] = [];
  const add = (code: IssueCode, detail: string) => issues.push({ code, detail });

  if (q.options.length !== 4) add("option_count", `${q.options.length} options, need 4`);
  if (q.options.map((o) => o.id).join("") !== "abcd".slice(0, q.options.length)) add("option_ids", "ids must be a, b, c, d in order");

  const texts = q.options.map((o) => norm(o.text));
  if (new Set(texts).size !== texts.length) add("duplicate_options", "two options say the same thing");

  const right = q.options.filter((o) => o.correct);
  if (right.length !== 1) add("correct_count", `${right.length} correct options, need exactly 1`);

  for (const o of q.options) {
    if (norm(o.explanation).length < 12) add("missing_explanation", `option ${o.id} has no real explanation`);
    if (CATCH_ALL.test(o.text.trim())) add("catch_all_option", `option ${o.id}: "${o.text}"`);
  }
  const why = q.options.map((o) => norm(o.explanation));
  if (new Set(why).size !== why.length) add("copied_explanation", "two options share an explanation");

  if (!/[?:]\s*$/.test(q.stem.trim())) add("not_a_question", "stem must end in a question mark or a colon");
  if (/\b(not|except|never)\b/.test(q.stem) && !/\b(NOT|EXCEPT|NEVER)\b/.test(q.stem)) add("negative_stem", "a negative stem must be in capitals");

  if (right.length === 1) {
    const answer = right[0];
    const stemNorm = norm(q.stem);
    const answerNorm = norm(answer.text);
    if (answerNorm.length > 2 && !/^[\d.\s-]+$/.test(answerNorm) && new RegExp(`(^|\\s)${answerNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(stemNorm)) {
      add("answer_in_stem", "the stem contains the answer");
    }
    // A clue word: a meaningful stem word that only the right answer repeats.
    const stemWords = new Set(words(q.stem).map(stem));
    const wrong = q.options.filter((o) => o !== answer);
    const inWrong = new Set(wrong.flatMap((o) => words(o.text).map(stem)));
    const clue = words(answer.text).map(stem).find((w) => stemWords.has(w) && !inWrong.has(w));
    if (clue) add("word_clue", `"${clue}" appears in the stem and only in the right answer`);
    // The question must not give away its own explanation.
    const explain = norm(answer.explanation);
    if (explain.length > 30 && stemNorm.includes(explain)) add("explanation_in_stem", "the stem contains the explanation");

    const longestWrong = Math.max(...wrong.map((o) => o.text.trim().length));
    const len = answer.text.trim().length;
    if (len > longestWrong * LENGTH_RATIO && len - longestWrong > LENGTH_SLACK) add("length_balance", `right answer is ${len} characters, longest wrong one is ${longestWrong}`);
  }
  return issues;
}

/** Ids that repeat, or stems that repeat, across a set. */
export function duplicateStems(qs: Question[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of qs) {
    const k = norm(q.stem);
    if (seen.has(k)) out.push(q.id);
    seen.add(k);
  }
  return out;
}

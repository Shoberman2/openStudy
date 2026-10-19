// Exercise generation from cards (spec 5.1) and checking of answers (spec 5.3).
import { checkTyped, scoreQuote, type DiffToken, type Verdict } from "./check";
import { STOPWORDS, containsTerm, normalizeAnswer, replaceTerm, truncate, wordCount } from "./text";
import type { Card, Grade } from "./types";
import { shuffle } from "./util";

export type FactType = "mc" | "tf" | "bank" | "type" | "match" | "flash" | "apply" | "def-mc" | "term-type" | "explain";
export type QuoteType = "q-bank1" | "q-bank3" | "q-order" | "q-letters" | "q-recall";
export type ExType = FactType | QuoteType;

export type Segment = string | { blank: number };

type Base = { id: string; cardIds: string[]; projectId: string };

export type Exercise = Base &
  (
    | { type: "mc"; prompt: string; options: string[]; answer: string }
    | { type: "tf"; statement: string; truth: boolean; trueStatement: string }
    | { type: "bank" | "q-bank1" | "q-bank3"; segments: Segment[]; answers: string[]; options: string[]; attribution?: string }
    | { type: "type"; prompt: string; accepted: string[]; answer: string }
    | { type: "match"; pairs: { key: string; term: string; clue: string }[]; terms: string[]; clues: string[] }
    | { type: "flash"; front: string; back: string; detail?: string }
    | { type: "apply"; statement: string }
    | { type: "def-mc"; term: string; options: string[]; answer: string }
    | { type: "term-type"; definition: string; accepted: string[]; answer: string }
    | { type: "explain"; topic: string; sources: string[] }
    | { type: "q-order"; chunks: string[]; shuffled: number[]; attribution?: string }
    | { type: "q-letters"; hint: string; target: string; attribution?: string }
    | { type: "q-recall"; target: string; attribution?: string; starts: string }
  );

export type Answer =
  | { kind: "choice"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "text"; value: string; ms?: number }
  | { kind: "slots"; value: string[] }
  | { kind: "order"; value: number[] }
  | { kind: "match"; mistakes: number }
  | { kind: "flash"; grade: Grade }
  | { kind: "rate"; grade: Grade };

export type CheckResult = {
  verdict: Verdict;
  /** Text to show as the correct answer in the feedback panel. */
  solution: string;
  note?: string;
  diff?: DiffToken[];
  grade: Grade;
};

let seq = 0;
const exId = () => `ex${Date.now().toString(36)}${(seq++).toString(36)}`;

// ---------- helpers ----------

export function clozeOf(card: Card): string | undefined {
  if (card.cloze && containsTerm(card.statement, card.cloze)) return card.cloze;
  return undefined;
}

function displayTerm(card: Card, term: string): string {
  const s = card.statement.replace(/^["“'(]+/, "");
  return s.startsWith(term) && term.length > 1 && term !== term.toUpperCase() ? term.toLowerCase() : term;
}

function blankedStatement(card: Card): string {
  const c = clozeOf(card);
  return c ? replaceTerm(card.statement, c, "____") : card.statement;
}

function factQuestion(card: Card): string {
  return card.question?.trim() || blankedStatement(card);
}

function factAnswer(card: Card): string {
  return card.answer?.trim() || (clozeOf(card) ? displayTerm(card, clozeOf(card)!) : card.statement);
}

function uniqNorm(xs: string[], exclude: string[] = []): string[] {
  const seen = new Set(exclude.map(normalizeAnswer));
  const out: string[] = [];
  for (const x of xs) {
    const k = normalizeAnswer(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function splitAround(statement: string, term: string): Segment[] {
  const marker = "\u0000";
  const replaced = replaceTerm(statement, term, marker);
  const [before, after] = replaced.split(marker);
  return [before, { blank: 0 }, after ?? ""];
}

type WordTok = { pre: string; core: string; post: string; idx: number };
function quoteTokens(text: string): WordTok[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, idx) => {
      const m = w.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u)!;
      return { pre: m[1], core: m[2], post: m[3], idx };
    });
}

function longWords(text: string): WordTok[] {
  return quoteTokens(text)
    .filter((t) => t.core.length >= 3 && !STOPWORDS.has(t.core.toLowerCase()))
    .sort((a, b) => b.core.length - a.core.length || a.idx - b.idx);
}

// ---------- fact exercises ----------

export type GenCtx = { pool: Card[]; rand: () => number; projectTitle?: string; lessonTitle?: string };

function otherAnswers(card: Card, ctx: GenCtx, want: number, short: boolean): string[] {
  const mine = short ? clozeOf(card) ?? factAnswer(card) : factAnswer(card);
  const target = mine.length;
  const cands = ctx.pool
    .filter((c) => c.id !== card.id && c.kind === "fact")
    .map((c) => (short ? (clozeOf(c) ? displayTerm(c, clozeOf(c)!) : undefined) : factAnswer(c)))
    .filter((x): x is string => !!x && !containsTerm(card.statement, x))
    .sort((a, b) => Math.abs(a.length - target) - Math.abs(b.length - target));
  return uniqNorm(cands, [mine]).slice(0, want);
}

export function genMC(card: Card, ctx: GenCtx): Exercise {
  const answer = factAnswer(card);
  let distractors = uniqNorm(card.distractors ?? [], [answer]).slice(0, 3);
  if (distractors.length < 3) distractors = uniqNorm([...distractors, ...otherAnswers(card, ctx, 6, false)], [answer]).slice(0, 3);
  return { id: exId(), cardIds: [card.id], projectId: card.projectId, type: "mc", prompt: factQuestion(card), answer, options: shuffle([answer, ...distractors], ctx.rand) };
}

export function genTF(card: Card, ctx: GenCtx): Exercise | null {
  const hasFalse = !!card.falseStatement && normalizeAnswer(card.falseStatement) !== normalizeAnswer(card.statement);
  if (!hasFalse) return null;
  const truth = ctx.rand() < 0.5;
  return { id: exId(), cardIds: [card.id], projectId: card.projectId, type: "tf", truth, statement: truth ? card.statement : card.falseStatement!, trueStatement: card.statement };
}

export function genBank(card: Card, ctx: GenCtx): Exercise | null {
  const c = clozeOf(card);
  if (!c) return null;
  const answer = displayTerm(card, c);
  const others = otherAnswers(card, ctx, 3, true).filter((w) => wordCount(w) <= 2);
  const fromStatement = shuffle(
    longWords(card.statement).map((t) => t.core).filter((w) => normalizeAnswer(w) !== normalizeAnswer(c)),
    ctx.rand,
  ).slice(0, 2);
  const extra = uniqNorm([...others, ...(card.distractors ?? []).filter((d) => wordCount(d) === 1)], [answer]).slice(0, 3);
  const options = shuffle(uniqNorm([answer, ...extra, ...fromStatement.map((w) => w.toLowerCase())]), ctx.rand);
  return { id: exId(), cardIds: [card.id], projectId: card.projectId, type: "bank", segments: splitAround(card.statement, c), answers: [answer], options };
}

export function genType(card: Card): Exercise {
  const c = clozeOf(card);
  const answer = factAnswer(card);
  if (c && (wordCount(answer) > 3 || !card.question)) {
    const term = displayTerm(card, c);
    return { id: exId(), cardIds: [card.id], projectId: card.projectId, type: "type", prompt: blankedStatement(card), accepted: [term], answer: term };
  }
  const accepted = [answer];
  if (c) accepted.push(c);
  return { id: exId(), cardIds: [card.id], projectId: card.projectId, type: "type", prompt: factQuestion(card), accepted, answer };
}

export function genMatch(cards: Card[], ctx: GenCtx): Exercise | null {
  const defs = cards.filter((c) => c.term && c.definition);
  if (defs.length >= 4) {
    const picked = defs.slice(0, 4);
    const pairs = picked.map((c) => ({ key: c.id, term: c.term!, clue: truncate(c.definition!, 70) }));
    return {
      id: exId(),
      cardIds: picked.map((c) => c.id),
      projectId: picked[0].projectId,
      type: "match",
      pairs,
      terms: shuffle(pairs.map((p) => p.key), ctx.rand),
      clues: shuffle(pairs.map((p) => p.key), ctx.rand),
    };
  }
  const usable = cards.filter((c) => clozeOf(c));
  const picked: Card[] = [];
  const seen = new Set<string>();
  for (const c of usable) {
    const k = normalizeAnswer(clozeOf(c)!);
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(c);
    if (picked.length === 4) break;
  }
  if (picked.length < 4) return null;
  const pairs = picked.map((c) => ({ key: c.id, term: displayTerm(c, clozeOf(c)!), clue: truncate(blankedStatement(c), 70) }));
  return {
    id: exId(),
    cardIds: picked.map((c) => c.id),
    projectId: picked[0].projectId,
    type: "match",
    pairs,
    terms: shuffle(pairs.map((p) => p.key), ctx.rand),
    clues: shuffle(pairs.map((p) => p.key), ctx.rand),
  };
}

export function genFlash(card: Card): Exercise {
  return { id: exId(), cardIds: [card.id], projectId: card.projectId, type: "flash", front: factQuestion(card), back: factAnswer(card), detail: card.statement };
}

export function genApply(card: Card): Exercise {
  return { id: exId(), cardIds: [card.id], projectId: card.projectId, type: "apply", statement: card.statement };
}

// ---------- definition and explain exercises (spec 8.5) ----------

export const isDefinition = (c: Card) => !!(c.term && c.definition);

export function genDefMC(card: Card, ctx: GenCtx): Exercise | null {
  if (!isDefinition(card)) return null;
  const others = uniqNorm(
    shuffle(
      ctx.pool.filter((c) => c.id !== card.id && isDefinition(c)).map((c) => c.definition!),
      ctx.rand,
    ),
    [card.definition!],
  ).slice(0, 3);
  if (others.length < 2) return null;
  return { id: exId(), cardIds: [card.id], projectId: card.projectId, type: "def-mc", term: card.term!, answer: card.definition!, options: shuffle([card.definition!, ...others], ctx.rand) };
}

export function genTermType(card: Card): Exercise | null {
  if (!isDefinition(card)) return null;
  return { id: exId(), cardIds: [card.id], projectId: card.projectId, type: "term-type", definition: card.definition!, accepted: [card.term!], answer: card.term! };
}

export function genExplain(card: Card, ctx: GenCtx): Exercise {
  const topic = card.term ?? (clozeOf(card) && wordCount(clozeOf(card)!) <= 3 ? displayTerm(card, clozeOf(card)!) : ctx.lessonTitle ?? "this idea");
  const sameSource = ctx.pool.filter((c) => c.id !== card.id && c.pageId && c.pageId === card.pageId && c.kind === "fact").slice(0, 1);
  return { id: exId(), cardIds: [card.id], projectId: card.projectId, type: "explain", topic, sources: [card.statement, ...sameSource.map((c) => c.statement)] };
}

// ---------- quote exercises ----------

function quoteDistractorWords(card: Card, ctx: GenCtx, n: number, exclude: string[]): string[] {
  const pool = ctx.pool
    .filter((c) => c.id !== card.id)
    .flatMap((c) => longWords(c.statement).map((t) => t.core.toLowerCase()))
    .filter((w) => !containsTerm(card.statement, w));
  const fallback = ["patience", "courage", "silence", "kindness", "attention", "reason", "purpose", "habit", "honest", "simple"];
  return uniqNorm(shuffle([...pool], ctx.rand).concat(shuffle(fallback, ctx.rand)), exclude).slice(0, n);
}

export function genQuoteBank(card: Card, ctx: GenCtx, blanks: 1 | 3): Exercise | null {
  const toks = quoteTokens(card.statement);
  const lw = longWords(card.statement);
  const k = Math.min(blanks, lw.length);
  if (k < 1) return null;
  const chosen = lw.slice(0, k).map((t) => t.idx).sort((a, b) => a - b);
  const segments: Segment[] = [];
  const answers: string[] = [];
  let buf = "";
  toks.forEach((t, i) => {
    const sep = i === 0 ? "" : " ";
    if (chosen.includes(t.idx)) {
      segments.push(buf + sep + t.pre);
      segments.push({ blank: answers.length });
      answers.push(t.core);
      buf = t.post;
    } else buf += sep + t.pre + t.core + t.post;
  });
  segments.push(buf);
  const extra = quoteDistractorWords(card, ctx, blanks === 1 ? 3 : 3, answers);
  return {
    id: exId(),
    cardIds: [card.id],
    projectId: card.projectId,
    type: blanks === 1 ? "q-bank1" : "q-bank3",
    segments,
    answers,
    options: shuffle([...answers, ...extra], ctx.rand),
    attribution: card.attribution,
  };
}

export function chunkQuote(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  // Split at punctuation boundaries, then cap chunks at ~6 words.
  let chunks: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    if (/[,;:.?!]["”’)]*$/.test(w) || cur.length >= 6) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  // Merge tiny chunks into the previous one.
  chunks = chunks.reduce<string[][]>((acc, c) => {
    if (acc.length && c.length < 2) acc[acc.length - 1].push(...c);
    else acc.push(c);
    return acc;
  }, []);
  while (chunks.length > 5) {
    let bi = 0;
    let bs = Infinity;
    for (let i = 0; i < chunks.length - 1; i++) {
      const s = chunks[i].length + chunks[i + 1].length;
      if (s < bs) [bs, bi] = [s, i];
    }
    chunks.splice(bi, 2, [...chunks[bi], ...chunks[bi + 1]]);
  }
  while (chunks.length < 3) {
    let bi = 0;
    for (let i = 1; i < chunks.length; i++) if (chunks[i].length > chunks[bi].length) bi = i;
    const c = chunks[bi];
    if (c.length < 2) break;
    const mid = Math.ceil(c.length / 2);
    chunks.splice(bi, 1, c.slice(0, mid), c.slice(mid));
  }
  return chunks.map((c) => c.join(" "));
}

export function genQuoteOrder(card: Card, ctx: GenCtx): Exercise | null {
  const chunks = chunkQuote(card.statement);
  if (chunks.length < 3) return null;
  let order = shuffle(chunks.map((_, i) => i), ctx.rand);
  for (let tries = 0; tries < 5 && order.every((v, i) => v === i); tries++) order = shuffle(order, ctx.rand);
  if (order.every((v, i) => v === i)) order = order.slice().reverse();
  return { id: exId(), cardIds: [card.id], projectId: card.projectId, type: "q-order", chunks, shuffled: order, attribution: card.attribution };
}

export function letterHint(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      let first = true;
      return w.replace(/[\p{L}\p{N}]/gu, (ch) => {
        if (first) {
          first = false;
          return ch;
        }
        return "_";
      });
    })
    .join(" ");
}

export function genQuoteLetters(card: Card): Exercise {
  return { id: exId(), cardIds: [card.id], projectId: card.projectId, type: "q-letters", hint: letterHint(card.statement), target: card.statement, attribution: card.attribution };
}

export function genQuoteRecall(card: Card): Exercise {
  const starts = card.statement.split(/\s+/).slice(0, 3).join(" ");
  return { id: exId(), cardIds: [card.id], projectId: card.projectId, type: "q-recall", target: card.statement, attribution: card.attribution, starts };
}

// ---------- checking ----------

export function checkAnswer(ex: Exercise, a: Answer): CheckResult {
  switch (ex.type) {
    case "mc": {
      const v: Verdict = a.kind === "choice" && a.value === ex.answer ? "correct" : "wrong";
      return { verdict: v, solution: ex.answer, grade: v === "correct" ? "good" : "again" };
    }
    case "tf": {
      const v: Verdict = a.kind === "bool" && a.value === ex.truth ? "correct" : "wrong";
      return { verdict: v, solution: ex.truth ? "True" : `False. ${ex.trueStatement}`, grade: v === "correct" ? "good" : "again" };
    }
    case "bank":
    case "q-bank1":
    case "q-bank3": {
      const vals = a.kind === "slots" ? a.value : [];
      const ok = ex.answers.every((ans, i) => normalizeAnswer(vals[i] ?? "") === normalizeAnswer(ans));
      const filled = ex.segments.map((s) => (typeof s === "string" ? s : ex.answers[s.blank])).join("");
      return { verdict: ok ? "correct" : "wrong", solution: filled.trim(), grade: ok ? "good" : "again" };
    }
    case "type": {
      const text = a.kind === "text" ? a.value : "";
      const v = checkTyped(text, ex.accepted);
      const fast = a.kind === "text" && (a.ms ?? Infinity) < 6000;
      return {
        verdict: v,
        solution: ex.answer,
        note: v === "close" ? `Watch the spelling: ${ex.answer}` : undefined,
        grade: v === "wrong" ? "again" : v === "close" ? "hard" : fast ? "easy" : "good",
      };
    }
    case "match": {
      const mistakes = a.kind === "match" ? a.mistakes : 0;
      return {
        verdict: mistakes === 0 ? "correct" : "close",
        solution: ex.pairs.map((p) => p.term).join(", "),
        note: mistakes ? `${mistakes} mismatch${mistakes === 1 ? "" : "es"} on the way` : undefined,
        grade: mistakes ? "hard" : "good",
      };
    }
    case "flash": {
      const g = a.kind === "flash" ? a.grade : "again";
      return { verdict: g === "again" ? "wrong" : g === "hard" ? "close" : "correct", solution: ex.back, grade: g };
    }
    case "apply": {
      const ok = a.kind === "text" && wordCount(a.value) >= 4;
      return { verdict: ok ? "correct" : "wrong", solution: "Any answer of four words or more counts.", grade: "good" };
    }
    case "def-mc": {
      const v: Verdict = a.kind === "choice" && a.value === ex.answer ? "correct" : "wrong";
      return { verdict: v, solution: ex.answer, grade: v === "correct" ? "good" : "again" };
    }
    case "term-type": {
      const text = a.kind === "text" ? a.value : "";
      const v = checkTyped(text, ex.accepted);
      const fast = a.kind === "text" && (a.ms ?? Infinity) < 6000;
      return {
        verdict: v,
        solution: ex.answer,
        note: v === "close" ? `Watch the spelling: ${ex.answer}` : undefined,
        grade: v === "wrong" ? "again" : v === "close" ? "hard" : fast ? "easy" : "good",
      };
    }
    case "explain": {
      const g = a.kind === "rate" ? a.grade : "again";
      return {
        verdict: g === "again" ? "wrong" : g === "hard" ? "close" : "correct",
        solution: ex.sources[0],
        note: g === "again" ? "Read the source again, then try once more." : g === "hard" ? "Partly there. It will come back soon." : undefined,
        grade: g,
      };
    }
    case "q-order": {
      const ok = a.kind === "order" && a.value.length === ex.chunks.length && a.value.every((v, i) => ex.chunks[v] === ex.chunks[i]);
      return { verdict: ok ? "correct" : "wrong", solution: ex.chunks.join(" "), grade: ok ? "good" : "again" };
    }
    case "q-letters":
    case "q-recall": {
      const text = a.kind === "text" ? a.value : "";
      const r = scoreQuote(text, ex.target);
      const fast = ex.type === "q-recall" && a.kind === "text" && (a.ms ?? Infinity) < 6000;
      return {
        verdict: r.verdict,
        solution: ex.target,
        diff: r.verdict === "correct" && r.ratio === 1 ? undefined : r.diff,
        note: r.verdict === "close" ? "Close. A few words are off." : undefined,
        grade: r.verdict === "wrong" ? "again" : r.verdict === "close" ? "hard" : fast ? "easy" : "good",
      };
    }
  }
}

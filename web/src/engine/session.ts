// Session builder (spec 5.2) and the in-session state machine (mistake re-queue).
import type { Verdict } from "./check";
import { shuffle } from "./util";
import {
  genApply,
  genDefMC,
  genExplain,
  genTermType,
  isDefinition,
  genBank,
  genFlash,
  genMC,
  genMatch,
  genQuoteBank,
  genQuoteLetters,
  genQuoteOrder,
  genQuoteRecall,
  genTF,
  genType,
  type ExType,
  type Exercise,
  type GenCtx,
} from "./exercises";
import { isDue } from "./srs";
import type { Card, Grade, Lesson, Profile, ProjectType } from "./types";

const THEME_MIX: ExType[][] = [
  ["mc", "tf", "match", "bank"],
  ["mc", "bank", "tf"],
  ["bank", "type", "mc"],
  ["type", "bank", "tf"],
  ["type", "type", "mc", "apply"],
];
const CLASS_MIX: ExType[][] = [
  ["def-mc", "mc", "match"],
  ["def-mc", "bank", "tf"],
  ["term-type", "bank", "mc"],
  ["term-type", "type", "explain"],
  ["term-type", "type", "mc", "explain"],
];
const QUOTE_MIX: ExType[][] = [
  ["q-bank1"],
  ["q-bank1", "q-bank3"],
  ["q-bank3", "q-order"],
  ["q-order", "q-letters"],
  ["q-letters", "q-recall"],
];

const PREF_TYPES: Record<string, ExType[]> = { tap: ["mc", "tf", "match", "def-mc"], blank: ["bank"], type: ["type", "term-type"] };

/** Due first (oldest due), then new, then least recently seen (earliest due). */
export function pickOrder(cards: Card[], now: Date): Card[] {
  const due = cards.filter((c) => isDue(c.srs, now)).sort((a, b) => a.srs.due.localeCompare(b.srs.due));
  const fresh = cards.filter((c) => c.srs.state === "new");
  const rest = cards
    .filter((c) => c.srs.state !== "new" && !isDue(c.srs, now))
    .sort((a, b) => a.srs.due.localeCompare(b.srs.due));
  return [...due, ...fresh, ...rest];
}

class CardPicker {
  private uses = new Map<string, number>();
  constructor(private order: Card[], private max = 2) {}
  /** Next card with the fewest uses, in priority order. */
  next(filter: (c: Card) => boolean = () => true): Card | null {
    for (let round = 0; round < this.max; round++) {
      for (const c of this.order) if ((this.uses.get(c.id) ?? 0) === round && filter(c)) return c;
    }
    return null;
  }
  take(c: Card) {
    this.uses.set(c.id, (this.uses.get(c.id) ?? 0) + 1);
  }
  available(filter: (c: Card) => boolean = () => true): Card[] {
    return this.order.filter((c) => (this.uses.get(c.id) ?? 0) < this.max && filter(c)).sort((a, b) => (this.uses.get(a.id) ?? 0) - (this.uses.get(b.id) ?? 0));
  }
}

function weightedPick(types: ExType[], weights: number[], rand: () => number): ExType {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < types.length; i++) {
    r -= weights[i];
    if (r <= 0) return types[i];
  }
  return types[types.length - 1];
}

function genFor(type: ExType, card: Card, ctx: GenCtx): Exercise | null {
  switch (type) {
    case "mc":
      return genMC(card, ctx);
    case "tf":
      return genTF(card, ctx);
    case "bank":
      return genBank(card, ctx);
    case "type":
      return genType(card);
    case "flash":
      return genFlash(card);
    case "apply":
      return genApply(card);
    case "def-mc":
      return genDefMC(card, ctx);
    case "term-type":
      return genTermType(card);
    case "explain":
      return genExplain(card, ctx);
    case "q-bank1":
      return genQuoteBank(card, ctx, 1);
    case "q-bank3":
      return genQuoteBank(card, ctx, 3);
    case "q-order":
      return genQuoteOrder(card, ctx);
    case "q-letters":
      return genQuoteLetters(card);
    case "q-recall":
      return genQuoteRecall(card);
    default:
      return null;
  }
}

export function buildSession(
  lesson: Lesson,
  cards: Card[],
  profile: Profile,
  now: Date,
  rand: () => number = Math.random,
  pool: Card[] = cards,
  opts: { projectType?: ProjectType } = {},
): Exercise[] {
  const mine = cards.filter((c) => c.lessonId === lesson.id);
  if (!mine.length) return [];
  const ctx: GenCtx = { pool: pool.length ? pool : mine, rand, lessonTitle: lesson.title };
  const isClass = opts.projectType === "class" || opts.projectType === "other";
  const picker = new CardPicker(pickOrder(mine, now));
  const lvl = Math.min(4, Math.max(0, lesson.level));
  const isQuotes = lesson.kind === "quotes";
  const length = isQuotes ? 8 : 10;
  let mix = (isQuotes ? QUOTE_MIX : isClass ? CLASS_MIX : THEME_MIX)[lvl].slice();
  if (!isQuotes && !profile.goals.includes("apply")) mix = mix.filter((t) => t !== "apply");
  // Definition exercises need definition cards; fall back to their cloze equivalents.
  if (isClass && !mine.some(isDefinition)) mix = mix.map((t) => (t === "def-mc" ? "mc" : t === "term-type" ? "type" : t));
  if (!mix.length) mix = ["mc"];
  const weights = mix.map((t) => (Object.entries(PREF_TYPES).some(([p, ts]) => profile.practice.includes(p as never) && ts.includes(t)) ? 2 : 1));

  const out: Exercise[] = [];
  let applyUsed = false;
  for (let slot = 0; slot < length * 3 && out.length < length; slot++) {
    let type = isQuotes ? weightedPick(mix, mix.map(() => 1), rand) : weightedPick(mix, weights, rand);
    const prev = out[out.length - 1]?.type;
    // Match uses 4 cards at once; on small lessons that would leave a very short session.
    const matches = out.filter((e) => e.type === "match").length;
    if (type === "match" && (prev === "match" || matches >= (mine.length >= 12 ? 2 : 1))) type = "mc";
    if (type === "type" && out.length === 0) type = mix.find((t) => t !== "type" && t !== "apply") ?? "mc";
    if ((type === "apply" || type === "explain") && (applyUsed || out.length === 0)) type = "type";
    if (type === "term-type" && out.length === 0) type = "def-mc";
    if (type === "type" && out.length === 0) type = "mc";

    if (type === "match") {
      const avail = picker.available((c) => !!c.cloze);
      const ex = genMatch(avail, ctx);
      if (ex) {
        ex.cardIds.forEach((id) => picker.take(mine.find((c) => c.id === id)!));
        out.push(ex);
        continue;
      }
      type = "mc";
    }
    const wantsDef = type === "def-mc" || type === "term-type";
    const card = (wantsDef ? picker.next(isDefinition) : null) ?? picker.next();
    if (!card) break;
    let ex = genFor(type, card, ctx);
    if (!ex && type === "term-type") ex = genType(card);
    if (!ex && isQuotes) ex = genQuoteLetters(card);
    if (!ex) ex = genMC(card, ctx);
    picker.take(card);
    if (ex.type === "apply" || ex.type === "explain") applyUsed = true;
    out.push(ex);
  }

  // Flashcards replace one slot when the user picked them (never the first).
  if (!isQuotes && profile.practice.includes("flash") && out.length > 2) {
    const idx = 1 + Math.floor(rand() * (out.length - 1));
    const target = out[idx];
    if (target.type !== "match" && target.type !== "apply") {
      const card = mine.find((c) => c.id === target.cardIds[0]);
      if (card) out[idx] = genFlash(card);
    }
  }
  return out;
}

/** Interleaved review across all projects (spec 5.2 Practice). */
export function buildPractice(cards: Card[], now: Date, rand: () => number = Math.random, size = 12): Exercise[] {
  const due = cards.filter((c) => isDue(c.srs, now)).sort((a, b) => a.srs.due.localeCompare(b.srs.due));
  if (!due.length) return [];
  const ctx: GenCtx = { pool: cards, rand };
  const picker = new CardPicker(due);
  const out: Exercise[] = [];
  while (out.length < size) {
    const card = picker.next();
    if (!card) break;
    picker.take(card);
    let ex: Exercise | null;
    if (card.kind === "quote") {
      ex = rand() < 0.5 ? genQuoteBank(card, ctx, 3) : genQuoteLetters(card);
      if (!ex) ex = genQuoteLetters(card);
    } else {
      const r = rand();
      const t: ExType = isDefinition(card)
        ? out.length === 0 || r < 0.5
          ? "def-mc"
          : "term-type"
        : out.length === 0
          ? r < 0.5
            ? "mc"
            : "bank"
          : r < 0.4
            ? "mc"
            : r < 0.7
              ? "bank"
              : "type";
      ex = genFor(t, card, ctx) ?? genMC(card, ctx);
    }
    out.push(ex);
  }
  return out;
}

/**
 * Practice test (spec 8.6): up to 20 questions across all of a project's lessons, recall-heavy,
 * interleaved round robin by lesson. Each card at most once.
 */
export function buildPracticeTest(lessons: Lesson[], cards: Card[], rand: () => number = Math.random, size = 20): Exercise[] {
  const ordered = lessons.slice().sort((a, b) => a.order - b.order);
  const queues = ordered.map((l) => shuffle(cards.filter((c) => c.lessonId === l.id), rand));
  const ctx: GenCtx = { pool: cards, rand };
  const picked: Card[] = [];
  while (picked.length < size && queues.some((q) => q.length)) {
    for (const q of queues) {
      const c = q.shift();
      if (c) picked.push(c);
      if (picked.length >= size) break;
    }
  }
  const factTypes: ExType[] = ["type", "tf", "mc", "type"];
  return picked.map((card, i) => {
    let ex: Exercise | null = null;
    if (card.kind === "quote") ex = i % 2 ? genQuoteLetters(card) : genQuoteBank(card, ctx, 3);
    else if (isDefinition(card)) ex = i % 3 === 2 ? genDefMC(card, ctx) : genTermType(card);
    else ex = genFor(factTypes[i % factTypes.length], card, ctx);
    return ex ?? (card.kind === "quote" ? genQuoteLetters(card) : genMC(card, ctx));
  });
}

export type TestResult = {
  accuracy: number;
  correct: number;
  total: number;
  perLesson: { lessonId: string; correct: number; total: number; accuracy: number }[];
  weakLessons: string[];
  missedCardIds: string[];
};

/** Score a practice test. Lessons under 70% accuracy are weak. Close answers count as correct. */
export function scoreTest(answers: { ex: Exercise; verdict: Verdict }[], cards: Card[]): TestResult {
  const lessonOf = new Map(cards.map((c) => [c.id, c.lessonId]));
  const per = new Map<string, { correct: number; total: number }>();
  const missed: string[] = [];
  let correct = 0;
  for (const { ex, verdict } of answers) {
    const ok = verdict !== "wrong";
    if (ok) correct++;
    else missed.push(...ex.cardIds);
    const lid = lessonOf.get(ex.cardIds[0]);
    if (!lid) continue;
    const e = per.get(lid) ?? { correct: 0, total: 0 };
    e.total++;
    if (ok) e.correct++;
    per.set(lid, e);
  }
  const perLesson = [...per.entries()].map(([lessonId, e]) => ({ lessonId, ...e, accuracy: e.total ? e.correct / e.total : 0 }));
  return {
    accuracy: answers.length ? correct / answers.length : 0,
    correct,
    total: answers.length,
    perLesson,
    weakLessons: perLesson.filter((l) => l.accuracy < 0.7).map((l) => l.lessonId),
    missedCardIds: [...new Set(missed)],
  };
}

/** A normal practice session from specific cards (e.g. "Review your misses"). */
export function buildFromCards(cards: Card[], pool: Card[], rand: () => number = Math.random): Exercise[] {
  const ctx: GenCtx = { pool, rand };
  return cards.map((card, i) => {
    if (card.kind === "quote") return genQuoteBank(card, ctx, 3) ?? genQuoteLetters(card);
    if (isDefinition(card)) return (i % 2 ? genTermType(card) : genDefMC(card, ctx)) ?? genMC(card, ctx);
    return (i % 2 ? genBank(card, ctx) : null) ?? genMC(card, ctx);
  });
}

export function nextDueDate(cards: Card[]): Date | null {
  const seen = cards.filter((c) => c.srs.state !== "new");
  if (!seen.length) return null;
  return new Date(seen.map((c) => c.srs.due).sort()[0]);
}

// ---------- runtime state ----------

export type SessionState = {
  queue: Exercise[];
  total: number;
  correct: number;
  attempts: Record<string, number>;
  mistakes: number;
  correctFirst: number;
  applyCorrect: number;
  combo: number;
  maxCombo: number;
  graded: Record<string, Grade>;
  startedAt: number;
};

export function startSession(exercises: Exercise[], now = Date.now()): SessionState {
  return { queue: exercises.slice(), total: exercises.length, correct: 0, attempts: {}, mistakes: 0, correctFirst: 0, applyCorrect: 0, combo: 0, maxCombo: 0, graded: {}, startedAt: now };
}

export function current(s: SessionState): Exercise | undefined {
  return s.queue[0];
}

export function isFinished(s: SessionState): boolean {
  return s.queue.length === 0;
}

export function progress(s: SessionState): number {
  return s.total ? s.correct / s.total : 0;
}

export function accuracy(s: SessionState): number {
  return s.total ? (s.correctFirst + s.applyCorrect) / s.total : 0;
}

/**
 * Record an answer for the current exercise. Wrong answers are re-queued at the end;
 * cards are graded only on their first attempt in the session.
 */
export function answerCurrent(s: SessionState, verdict: Verdict, grade: Grade): { state: SessionState; newlyGraded: Record<string, Grade> } {
  const ex = s.queue[0];
  if (!ex) return { state: s, newlyGraded: {} };
  const attempt = (s.attempts[ex.id] ?? 0) + 1;
  const ok = verdict !== "wrong";
  const newlyGraded: Record<string, Grade> = {};
  if (ex.type !== "apply") for (const id of ex.cardIds) if (!(id in s.graded)) newlyGraded[id] = grade;
  const combo = ok ? s.combo + 1 : 0;
  const state: SessionState = {
    ...s,
    queue: ok ? s.queue.slice(1) : [...s.queue.slice(1), ex],
    attempts: { ...s.attempts, [ex.id]: attempt },
    correct: s.correct + (ok ? 1 : 0),
    mistakes: s.mistakes + (ok ? 0 : 1),
    correctFirst: s.correctFirst + (ok && attempt === 1 && ex.type !== "apply" ? 1 : 0),
    applyCorrect: s.applyCorrect + (ok && ex.type === "apply" && attempt === 1 ? 1 : 0),
    combo,
    maxCombo: Math.max(s.maxCombo, combo),
    graded: { ...s.graded, ...newlyGraded },
  };
  return { state, newlyGraded };
}

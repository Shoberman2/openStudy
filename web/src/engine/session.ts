// Session builder (spec 5.2) and the in-session state machine (mistake re-queue).
import type { Verdict } from "./check";
import { complexityDistractors, isClozeVerb, shapeClass } from "./builder";
import { isCode, normalizeCode, onlyInCode } from "./code";
import { containsTerm, normalizeAnswer, tokens, wordCount } from "./text";
import { shuffle } from "./util";
import {
  genApply,
  genDefMC,
  genPicture,
  genExplain,
  genTermType,
  clozeOf,
  isConcept,
  isDefinition,
  genBank,
  genFlash,
  genMC,
  genPageMC,
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
  type McForm,
  type PageForm,
} from "./exercises";
import { MAX_PICTURES_PER_SESSION, isPicture } from "./pictures";
import { isDue } from "./srs";
import type { Card, Grade, Lesson, Profile, ProjectType } from "./types";

export type SessionProjectOptions = {
  projectType?: ProjectType;
  projectTypes?: ReadonlyMap<string, ProjectType | undefined>;
};

function usesDrillRules(opts: SessionProjectOptions, projectId: string): boolean {
  const type = opts.projectType ?? opts.projectTypes?.get(projectId);
  return type === "class" || type === "other";
}

const QUOTE_MIX: ExType[][] = [
  ["q-bank1"],
  ["q-bank1", "q-bank3"],
  ["q-bank3", "q-order"],
  ["q-order", "q-letters"],
  ["q-letters", "q-recall"],
];


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
  /** Next card with the fewest uses, in priority order; `rounds` 1 means unused cards only. */
  next(filter: (c: Card) => boolean = () => true, rounds = this.max): Card | null {
    for (let round = 0; round < rounds; round++) {
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

const MC_FORMS: McForm[] = ["concept", "gist", "odd"];
const PAGE_FORMS: PageForm[] = ["gist", "odd"];

/**
 * A blank worth filling in (spec 13.8): a definition's term, or a cloze word whose stem shows up on 2 or
 * more fact cards in the pool but on no more than 30% of them. A word on one card ("on earth") is trivia,
 * and a word on most cards ("person") gives nothing away about the idea.
 */
/** Everyday words that are never the point of a sentence, so they are never blanked. */
const PLAIN_WORDS = new Set(
  "want wants wanted take takes make makes made feel feels seem seems part good best better big new way ways self life thing things people person time times every little great really need needs needed give gives get gets go goes come comes look looks know knows keep keeps start starts find finds help helps tell tells talk talks show shows long much many most more first last next same other others another instead about rather without within never always often".split(" "),
);

export type BlankFinder = ((c: Card) => string | undefined) & { wrong: (c: Card, word: string, n: number) => string[] };

export function keyBlanks(pool: Card[]): BlankFinder {
  const cardsWith = new Map<string, number>();
  let facts = 0;
  for (const c of pool) {
    if (c.kind !== "fact") continue;
    facts++;
    for (const st of new Set(tokens(c.statement).map((t) => t.stem))) cardsWith.set(st, (cardsWith.get(st) ?? 0) + 1);
  }
  const most = Math.max(2, Math.floor(facts * 0.3));
  const isKey = (stem: string | undefined, surface: string) => {
    const n = stem ? (cardsWith.get(stem) ?? 0) : 0;
    return n >= 2 && n <= most && surface.length >= 5 && !PLAIN_WORDS.has(surface.toLowerCase()) && !isClozeVerb(surface);
  };
  // Every key word in the pool, for wrong answers that read like the right one.
  const keyWords = new Map<string, string>();
  for (const c of pool) {
    if (c.kind !== "fact") continue;
    for (const t of tokens(c.statement)) {
      if (!keyWords.has(t.stem) && isKey(t.stem, t.surface) && !onlyInCode(c.statement, t.surface)) keyWords.set(t.stem, t.surface.toLowerCase());
    }
  }
  const find = (c: Card): string | undefined => {
    if (isDefinition(c)) return c.term;
    // A word said twice in the sentence would give its own blank away.
    const own = new Map<string, number>();
    for (const t of tokens(c.statement)) own.set(t.stem, (own.get(t.stem) ?? 0) + 1);
    const once = (stem: string | undefined) => !!stem && own.get(stem) === 1;
    if (c.kind !== "fact") return undefined;
    // The card's own blank when it is a key word, else the statement's key word on the most cards.
    const cz = clozeOf(c);
    if (cz && !onlyInCode(c.statement, cz)) {
      const parts = tokens(cz);
      if ((isCode(cz) || parts.some((t) => isKey(t.stem, cz))) && parts.every((t) => once(t.stem))) return cz;
    }
    let best: { word: string; n: number } | undefined;
    for (const t of tokens(c.statement)) {
      if (!isKey(t.stem, t.surface) || !once(t.stem) || !containsTerm(c.statement, t.surface) || onlyInCode(c.statement, t.surface)) continue;
      // Shared by more cards first, then the longer (more specific) word.
      const n = cardsWith.get(t.stem)! * 100 + t.surface.length;
      if (!best || n > best.n) best = { word: t.surface, n };
    }
    return best?.word;
  };
  const wrong = (c: Card, word: string, n: number) => {
    const w = word.toLowerCase();
    const shape = shapeClass(w);
    const own = tokens(w)[0]?.stem;
    // Other key words, never one with the same stem ("thinking" for "think") or one already in the sentence.
    return [...keyWords.entries()]
      .filter(([st, k]) => st !== own && !containsTerm(c.statement, k))
      .map(([, k]) => k)
      .sort((a, b) => Number(shapeClass(b) === shape) - Number(shapeClass(a) === shape) || Math.abs(a.length - w.length) - Math.abs(b.length - w.length) || a.localeCompare(b))
      .slice(0, n);
  };
  return Object.assign(find, { wrong });
}

/**
 * The card with its blank on its key word and wrong answers that are other key words of the same shape,
 * topped up with its own single-word wrong answers.
 */
function withBlank(card: Card, blankOf: BlankFinder): Card {
  const word = blankOf(card)!;
  if (isDefinition(card)) return card;
  const own = word === clozeOf(card) ? (card.distractors ?? []).filter((d) => wordCount(d) === 1 && !containsTerm(card.statement, d)) : [];
  const wrong = [...new Set([...blankOf.wrong(card, word, 3), ...own])].slice(0, 3);
  return { ...card, cloze: word, question: undefined, answer: undefined, distractors: wrong, falseStatement: undefined };
}

/** A concept card that can pair its question with a right or wrong answer (13.4). Others never play true or false. */
const tfReady = (c: Card) => isConcept(c) && !!c.distractors?.length;

/** The k-th mc slot of a lesson (spec 13.7): forms cycle from k and the first one that works wins, unused cards first. */
function mixedMC(picker: CardPicker, ctx: GenCtx, k: number, asked: Set<string>): { card: Card; ex: Exercise } | null {
  for (const rounds of [1, 2]) {
    for (let i = 0; i < MC_FORMS.length; i++) {
      const form = MC_FORMS[(k + i) % MC_FORMS.length];
      if (form === "concept") {
        const card = picker.next(isConcept, rounds);
        if (card) return { card, ex: { ...genMC(card, ctx), form } as Exercise };
        continue;
      }
      // Every card on a page gives the same gist and odd question, so each is asked once per session.
      const key = (c: Card) => `${form}:${c.pageId}`;
      const made: { ex: Exercise | null } = { ex: null };
      const card = picker.next((c) => !asked.has(key(c)) && !!(made.ex = genPageMC(c, ctx, form)), rounds);
      if (card && made.ex) {
        asked.add(key(card));
        return { card, ex: made.ex };
      }
    }
  }
  return null;
}

/** One card's mc outside a lesson (spec 13.7 Practice): its concept question, else a page form, else plain. */
function cardMC(card: Card, ctx: GenCtx, k: number): Exercise {
  if (isConcept(card)) return { ...genMC(card, ctx), form: "concept" } as Exercise;
  for (let i = 0; i < PAGE_FORMS.length; i++) {
    const ex = genPageMC(card, ctx, PAGE_FORMS[(k + i) % PAGE_FORMS.length]);
    if (ex) return ex;
  }
  return genMC(card, ctx);
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
    case "picture":
      return genPicture(card);
    default:
      return null;
  }
}

type Slot = "M" | "bank" | "type" | "tf" | "explain" | "apply" | "match";

/**
 * Which kind of question each slot of a lesson asks (spec 13.8): multiple choice everywhere except four
 * slots (2, 4, 6, 8) that take two fill-ins and two others in a shuffled order.
 */
export function slotPlan(level: number, length: number, opts: { apply: boolean; match: boolean }, rand: () => number): Slot[] {
  const lvl = Math.min(4, Math.max(0, level));
  const fills: Slot[] = lvl <= 1 ? ["bank", "bank"] : lvl <= 3 ? ["bank", "type"] : ["type", "bank"];
  const others: Slot[] = lvl <= 1 ? [opts.match ? "match" : "tf", "tf"] : ["tf", lvl >= 4 && opts.apply ? "apply" : "explain"];
  const special = shuffle([...fills, ...others], rand);
  const plan: Slot[] = Array.from({ length }, () => "M");
  [2, 4, 6, 8].forEach((at, i) => {
    if (at < length) plan[at] = special[i];
  });
  return plan;
}

export function buildSession(
  lesson: Lesson,
  cards: Card[],
  profile: Profile,
  now: Date,
  rand: () => number = Math.random,
  pool: Card[] = cards,
  opts: SessionProjectOptions = {},
): Exercise[] {
  const all = cards.filter((c) => c.lessonId === lesson.id);
  if (!all.length) return [];
  // Picture cards (spec 11.2) play only as picture exercises, at most 3, never first.
  const pictures = pickOrder(all.filter(isPicture), now);
  const mine = all.filter((c) => !isPicture(c));
  const sessionLength = lesson.kind === "quotes" ? 8 : 10;
  if (!mine.length) return pictures.slice(0, sessionLength).map((c) => genPicture(c)!);
  const nPictures = Math.min(MAX_PICTURES_PER_SESSION, pictures.length);
  const ctx: GenCtx = { pool: pool.length ? pool : mine, rand, lessonTitle: lesson.title };
  const picker = new CardPicker(pickOrder(mine, now));
  const lvl = Math.min(4, Math.max(0, lesson.level));
  const length = sessionLength - nPictures;
  const drill = usesDrillRules(opts, lesson.projectId);
  const recallCards = new Set<string>();
  const out = lesson.kind === "quotes" ? quoteSession(picker, ctx, lvl, length) : lessonSession(picker, ctx, mine, lvl, length, profile, drill, recallCards);

  // Flashcards replace one slot when the user picked them (never the first).
  if (lesson.kind !== "quotes" && profile.practice.includes("flash") && out.length > 2) {
    const idx = 1 + Math.floor(rand() * (out.length - 1));
    const target = out[idx];
    const swapsRecall = target.type === "term-type" && recallCards.has(target.cardIds[0]);
    const swapsRecognition = out.findIndex((ex) => ex.cardIds.some((id) => recallCards.has(id))) === idx;
    if (target.type !== "match" && target.type !== "apply" && !swapsRecall && !swapsRecognition) {
      const card = mine.find((c) => c.id === target.cardIds[0]);
      if (card) out[idx] = genFlash(card);
    }
  }
  return insertPictures(out, pictures.slice(0, nPictures), rand);
}

function quoteSession(picker: CardPicker, ctx: GenCtx, lvl: number, length: number): Exercise[] {
  const mix = QUOTE_MIX[lvl];
  const out: Exercise[] = [];
  while (out.length < length) {
    const card = picker.next();
    if (!card) break;
    const type = weightedPick(mix, mix.map(() => 1), ctx.rand);
    out.push(genFor(type, card, ctx) ?? genQuoteLetters(card) ?? genMC(card, ctx));
    picker.take(card);
  }
  return out;
}

/** Theme and class lessons (spec 13.8): a majority of multiple choice, two fill-ins and two others. */
function lessonSession(picker: CardPicker, ctx: GenCtx, mine: Card[], lvl: number, length: number, profile: Profile, drill: boolean, recallCards: Set<string>): Exercise[] {
  // Word lists and glossaries practice like a class (spec 10.2): half or more of the cards are definitions.
  const defs = mine.filter(isDefinition);
  const isClass = drill || defs.length * 2 >= mine.length;
  const blankOf = keyBlanks(ctx.pool);
  const keyBlank = (c: Card) => !!blankOf(c);
  ctx.isKey = (c) => !!blankOf(c) && blankOf(c) === clozeOf(c);
  const plan = slotPlan(lvl, length, { apply: profile.goals.includes("apply"), match: isClass && defs.length >= 4 }, ctx.rand);
  const out: Exercise[] = [];
  const asked = new Set<string>();
  // A card plays at most one fill-in per session, so the same blank never shows up twice.
  const filled = new Set<string>();
  const recognized = new Set<string>();
  const chosen = new Set<string>();
  let mcSlots = 0;
  let deepUsed = false;
  const add = (card: Card, ex: Exercise) => {
    if (isDefinition(card) && (ex.type === "def-mc" || ex.type === "mc")) recognized.add(card.id);
    chosen.add(`${card.id}:${ex.type}`);
    picker.take(card);
    out.push(ex);
  };
  const unusedFirst = (f: (c: Card) => boolean) => picker.next(f, 1) ?? picker.next(f);

  for (let i = 0; i < plan.length; i++) {
    const slot = plan[i];
    if (slot !== "M" && lvl <= 1 && recallCards.size === 0) {
      const seen = (c: Card) => recognized.has(c.id);
      const card = picker.next((c) => seen(c) && isCode(c.term) && !c.term!.includes(" followed by ")) ?? picker.next(seen);
      const recall = card && genTermType(card, true);
      if (card && recall) {
        recallCards.add(card.id);
        filled.add(card.id);
        add(card, recall);
        continue;
      }
    }
    if (slot === "bank" || slot === "type") {
      const card = unusedFirst((c) => !filled.has(c.id) && (drill && !isDefinition(c) ? !!drillBlank(c, blankOf)
        : keyBlank(c) && (!drill || lvl > 1 || !chosen.has(`${c.id}:def-mc`))));
      if (card) filled.add(card.id);
      const fc = card && (drill && !isDefinition(card) ? drillBlank(card, blankOf) : withBlank(card, blankOf));
      const ex = fc && (slot === "type" ? (isDefinition(fc) ? genTermType(fc) : genType(fc)) : isDefinition(fc) && lvl <= 1 ? genDefMC(fc, ctx) : genBank(fc, drill ? { ...ctx, pool: [] } : ctx));
      if (card && ex) {
        add(card, ex);
        continue;
      }
    } else if (slot === "tf") {
      const card = unusedFirst((c) => tfReady(c) && (!drill || !chosen.has(`${c.id}:tf`)));
      const ex = card && genTF(card, ctx);
      if (card && ex) {
        add(card, ex);
        continue;
      }
    } else if (slot === "match") {
      const ex = genMatch(picker.available(isDefinition), ctx, drill);
      if (ex) {
        ex.cardIds.forEach((id) => {
          recognized.add(id);
          picker.take(mine.find((c) => c.id === id)!);
        });
        out.push(ex);
        continue;
      }
    } else if ((slot === "explain" || slot === "apply") && !deepUsed) {
      // Explain a named idea when there is one (a concept or a term), so the topic is never a stray word.
      const card = slot === "explain" ? unusedFirst((c) => isConcept(c) || isDefinition(c)) ?? picker.next() : unusedFirst((c) => !isDefinition(c));
      if (card) {
        deepUsed = true;
        add(card, slot === "apply" ? genApply(card) : genExplain(card, ctx));
        continue;
      }
    }
    // Multiple choice, or a slot above that could not be used.
    const k = mcSlots++;
    if ((isClass && k % 2 === 0) || (lvl <= 1 && k === 0)) {
      const syntax = drill && lvl <= 1 && k === 0 ? picker.next((c) => isDefinition(c) && isCode(c.term), 1) : null;
      const card = syntax ?? picker.next(isDefinition, 1);
      const ex = card && (genDefMC(card, ctx) ?? (lvl <= 1 && k === 0 ? drillMC(card, ctx, blankOf, filled, chosen) : null));
      if (card && ex) {
        add(card, ex);
        continue;
      }
    }
    if (drill) {
      for (const card of picker.available()) {
        const ex = drillMC(card, ctx, blankOf, filled, chosen);
        if (!ex) continue;
        if (ex.type === "mc" && ex.prompt.includes("____")) filled.add(card.id);
        add(card, ex);
        break;
      }
      continue;
    }
    const picked = mixedMC(picker, ctx, k, asked);
    if (picked) {
      add(picked.card, picked.ex);
      continue;
    }
    // Nothing new to ask about an idea: a missing key word, then an idea question again, then any card.
    const again = picker.available((c) => keyBlank(c) && !filled.has(c.id)).length ? null : mixedMC(picker, ctx, k, new Set());
    if (again) {
      add(again.card, again.ex);
      continue;
    }
    const card = unusedFirst((c) => keyBlank(c) && !filled.has(c.id)) ?? picker.next();
    if (!card) continue;
    if (keyBlank(card)) filled.add(card.id);
    const fc = keyBlank(card) && !isConcept(card) ? withBlank(card, blankOf) : card;
    // Definitions alternate: pick the definition for a term, then the term for a definition.
    add(card, isDefinition(card) ? (k % 2 === 0 ? genDefMC(card, ctx) : null) ?? genMC(card, ctx) : genMC(fc, ctx));
  }
  return out;
}

/** A constrained blank needs plausible choices of its own. Generic fallback words are omitted. */
function drillBlank(card: Card, blankOf: BlankFinder): Card | undefined {
  if (isConcept(card) || card.kind !== "fact") return undefined;
  const notation = /^[OΘΩ]\(/;
  const statedBound = card.statement.match(/(?:takes |runs in |is written as )([OΘΩ]\([^()]+\))(?= (?:time|space)\b|[.!?]?$)/)?.[1];
  const word = statedBound ?? blankOf(card);
  if (!word || (!statedBound && word !== clozeOf(card)) || /^big o$/i.test(word)) return undefined;
  const shape = shapeClass(word);
  const distractors = notation.test(word) ? complexityDistractors(card.statement, word)
    : (card.distractors ?? []).filter((d) => !containsTerm(card.statement, d) && !isCode(d) && shapeClass(d) === shape);
  if (distractors.length < 2) return undefined;
  const statement = notation.test(word) ? `Use the tightest bound. ${card.statement}` : card.statement;
  return { ...card, statement, cloze: word, question: undefined, answer: undefined, distractors };
}

function drillMC(card: Card, ctx: GenCtx, blankOf: BlankFinder, filled = new Set<string>(), chosen = new Set<string>()): Exercise | null {
  if (isDefinition(card)) {
    // Use the original terms so code symbols and case survive reverse recognition.
    if (chosen.has(`${card.id}:mc`)) return null;
    const code = isCode(card.term);
    const terms = ctx.pool
      .filter((c) => c.id !== card.id && isDefinition(c) && isCode(c.term) === code)
      .sort((a, b) => Number(b.lessonId === card.lessonId) - Number(a.lessonId === card.lessonId)
        || Math.abs(a.term!.length - card.term!.length) - Math.abs(b.term!.length - card.term!.length))
      .map((c) => c.term!);
    const normalize = code ? normalizeCode : normalizeAnswer;
    const seen = new Set([normalize(card.term!)]);
    const options = terms.filter((term) => {
      const key = normalize(term);
      if (seen.has(key) || containsTerm(card.definition!, term, code)) return false;
      seen.add(key);
      return true;
    }).slice(0, 3);
    if (options.length === 0) return chosen.has(`${card.id}:def-mc`) ? null : genDefMC(card, ctx);
    const ex = genMC({ ...card, answer: card.term, distractors: [] }, { ...ctx, pool: [] });
    return ex.type === "mc" ? { ...ex, options: shuffle([card.term!, ...options], ctx.rand) } : null;
  }
  if (chosen.has(`${card.id}:mc`)) return null;
  if (isConcept(card)) return card.question!.includes("____") ? null : { ...genMC(card, ctx), form: "concept" } as Exercise;
  const blank = !filled.has(card.id) && drillBlank(card, blankOf);
  return blank ? genMC(blank, { ...ctx, pool: [] }) : null;
}

/** Put picture exercises at random positions after the first. */
function insertPictures(out: Exercise[], pics: Card[], rand: () => number): Exercise[] {
  const res = out.slice();
  for (const c of pics) {
    const ex = genPicture(c);
    if (!ex) continue;
    if (!res.length) {
      res.push(ex);
      continue;
    }
    res.splice(1 + Math.floor(rand() * res.length), 0, ex);
  }
  return res;
}

/** Select review questions using the same project rules as lessons. */
function reviewedFact(card: Card, ctx: GenCtx, blankOf: BlankFinder, drill: boolean, index: number, slot: "M" | "bank" | "type" | "tf"): Exercise | null {
  if (slot === "tf" && tfReady(card)) return genTF(card, ctx);
  if (slot === "bank" || slot === "type") {
    const blank = drill ? drillBlank(card, blankOf) : blankOf(card) ? withBlank(card, blankOf) : null;
    if (blank) {
      const ex = slot === "type" ? genType(blank) : genBank(blank, drill ? { ...ctx, pool: [] } : ctx);
      if (ex) return ex;
    }
  }
  return drill ? drillMC(card, ctx, blankOf) : cardMC(card, ctx, index);
}

/** Interleaved review across all projects (spec 5.2 Practice). */
export function buildPractice(cards: Card[], now: Date, rand: () => number = Math.random, size = 12, opts: SessionProjectOptions = {}): Exercise[] {
  const dueAll = cards.filter((c) => isDue(c.srs, now)).sort((a, b) => a.srs.due.localeCompare(b.srs.due));
  if (!dueAll.length) return [];
  const duePictures = dueAll.filter(isPicture);
  const due = dueAll.filter((c) => !isPicture(c));
  if (!due.length) return duePictures.slice(0, size).map((c) => genPicture(c)!);
  const nPictures = Math.min(MAX_PICTURES_PER_SESSION, duePictures.length);
  size -= nPictures;
  const ctx: GenCtx = { pool: cards, rand };
  const blankOf = keyBlanks(cards);
  const picker = new CardPicker(due);
  const out: Exercise[] = [];
  while (out.length < size) {
    const card = picker.next();
    if (!card) break;
    picker.take(card);
    const drill = usesDrillRules(opts, card.projectId);
    let ex: Exercise | null;
    if (card.kind === "quote") {
      ex = rand() < 0.5 ? genQuoteBank(card, ctx, 3) : genQuoteLetters(card);
      if (!ex) ex = genQuoteLetters(card);
    } else if (isDefinition(card)) {
      const t: ExType = out.length === 0 || rand() < 0.5 ? "def-mc" : "term-type";
      ex = genFor(t, card, ctx) ?? (drill ? drillMC(card, ctx, blankOf) ?? genTermType(card) : genMC(card, ctx));
    } else {
      // Mostly multiple choice, some fill-ins on key words, a few true or false (spec 13.8).
      const r = out.length ? rand() : 0;
      const slot = r >= 0.85 && tfReady(card) ? "tf" : r >= 0.65 ? "bank" : "M";
      ex = reviewedFact(card, ctx, blankOf, drill, out.length, slot);
    }
    if (ex) out.push(ex);
  }
  return insertPictures(out, duePictures.slice(0, nPictures), rand);
}

/**
 * Practice test (spec 8.6): up to 20 questions across all of a project's lessons, recall-heavy,
 * interleaved round robin by lesson. Each card at most once.
 */
export function buildPracticeTest(lessons: Lesson[], cards: Card[], rand: () => number = Math.random, size = 20, opts: SessionProjectOptions = {}): Exercise[] {
  const ordered = lessons.slice().sort((a, b) => a.order - b.order);
  // Practice tests skip picture cards (spec 11.2).
  const queues = ordered.map((l) => shuffle(cards.filter((c) => c.lessonId === l.id && !isPicture(c)), rand));
  const ctx: GenCtx = { pool: cards, rand };
  const blankOf = keyBlanks(cards);
  const out: Exercise[] = [];
  while (out.length < size && queues.some((q) => q.length)) {
    for (const q of queues) {
      const card = q.shift();
      if (!card) continue;
      const i = out.length;
      const drill = usesDrillRules(opts, card.projectId);
      let ex: Exercise | null;
      if (card.kind === "quote") ex = (i % 2 ? genQuoteLetters(card) : genQuoteBank(card, ctx, 3)) ?? genQuoteLetters(card);
      else if (isDefinition(card)) ex = (i % 3 === 2 ? genDefMC(card, ctx) : genTermType(card)) ?? (drill ? genTermType(card) : genMC(card, ctx));
      else ex = reviewedFact(card, ctx, blankOf, drill, i, i % 4 === 1 ? "type" : i % 4 === 3 ? "tf" : "M");
      if (ex) out.push(ex);
      if (out.length >= size) break;
    }
  }
  return out;
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
export function buildFromCards(cards: Card[], pool: Card[], rand: () => number = Math.random, opts: SessionProjectOptions = {}): Exercise[] {
  const ctx: GenCtx = { pool, rand };
  const blankOf = keyBlanks(pool);
  return cards.map((card, i) => {
    const drill = usesDrillRules(opts, card.projectId);
    if (card.kind === "picture") return genPicture(card) ?? genMC(card, ctx);
    if (card.kind === "quote") return genQuoteBank(card, ctx, 3) ?? genQuoteLetters(card);
    if (isDefinition(card)) return (i % 2 ? genTermType(card) : genDefMC(card, ctx)) ?? (drill ? genTermType(card) : genMC(card, ctx));
    return reviewedFact(card, ctx, blankOf, drill, i, i % 4 === 1 ? "bank" : i % 4 === 3 ? "tf" : "M");
  }).filter((ex) => ex !== null);
}

/** "Practice both" (spec 10.8): cards of two lessons from different projects, alternating, theme mix level 1. */
export function buildConnection(lessonA: string, lessonB: string, cards: Card[], now: Date, rand: () => number = Math.random, size = 10, opts: SessionProjectOptions = {}): Exercise[] {
  const a = pickOrder(cards.filter((c) => c.lessonId === lessonA && c.kind === "fact"), now);
  const b = pickOrder(cards.filter((c) => c.lessonId === lessonB && c.kind === "fact"), now);
  const order: Card[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) order.push(a[i]);
    if (b[i]) order.push(b[i]);
  }
  if (!order.length) return [];
  const ctx: GenCtx = { pool: cards, rand };
  const blankOf = keyBlanks(cards);
  const out: Exercise[] = [];
  for (let i = 0; out.length < size && i < order.length * 2; i++) {
    const card = order[i % order.length];
    const drill = usesDrillRules(opts, card.projectId);
    const ex = reviewedFact(card, ctx, blankOf, drill, i, i % 3 === 2 ? "tf" : "M");
    if (ex) out.push(ex);
  }
  return out;
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

/** Exercises built from concept cards, for the `concepts` prop of `session_start` (spec 13.4). */
export function conceptExercises(exercises: Exercise[], cards: Card[]): number {
  const concept = new Set(cards.filter(isConcept).map((c) => c.id));
  return exercises.filter((e) => e.cardIds.some((id) => concept.has(id))).length;
}

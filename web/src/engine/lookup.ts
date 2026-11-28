// Remember a Fact (spec 19): a fact you looked up becomes a card in one "Looked Up" set,
// quizzed from tomorrow on the usual spaced schedule. Plain Library v1 records, so iOS can read them.
import { genFlash, type Exercise } from "./exercises";
import { logEvent, nextColor } from "./library";
import { quantity } from "./check";
import { wordCount } from "./text";
import type { Card, Lesson, Library, Project } from "./types";
import { addDays, newId, startOfLocalDay } from "./util";

export const LOOKED_UP_ID = "lookedup";
export const LOOKED_UP_LESSON_ID = "lookedup-facts";
export const LOOKED_UP_TITLE = "Looked Up";

export const isLookup = (x: { projectId: string }) => x.projectId === LOOKED_UP_ID;

export type Fact = { question: string; answer: string; source?: string };

/** Save one fact. Saving counts as the first look: the first quiz is tomorrow. */
export function rememberFact(lib: Library, fact: Fact, now: Date = new Date(), id: string = newId()): Library {
  const question = fact.question.trim().replace(/\s+/g, " ");
  const answer = fact.answer.trim().replace(/\s+/g, " ");
  if (!question || !answer) return lib;
  let next = lib;
  if (!next.projects.some((p) => p.id === LOOKED_UP_ID)) {
    const project: Project = {
      id: LOOKED_UP_ID,
      title: LOOKED_UP_TITLE,
      color: nextColor(next),
      createdAt: now.toISOString(),
      focus: "ideas",
      quotesAsked: true,
      type: "other",
      category: LOOKED_UP_TITLE,
    };
    next = { ...next, projects: [...next.projects, project] };
  }
  if (!next.lessons.some((l) => l.id === LOOKED_UP_LESSON_ID)) {
    const lesson: Lesson = { id: LOOKED_UP_LESSON_ID, projectId: LOOKED_UP_ID, title: LOOKED_UP_TITLE, summary: "Facts you looked up", kind: "theme", order: 0, level: 0, sessions: 0 };
    next = { ...next, lessons: [...next.lessons, lesson] };
  }
  const card: Card = {
    id,
    lessonId: LOOKED_UP_LESSON_ID,
    projectId: LOOKED_UP_ID,
    kind: "fact",
    statement: `${question.replace(/\?*$/, "?")} ${answer}`,
    question,
    answer,
    attribution: fact.source?.trim() || undefined,
    srs: { state: "review", ease: 2.5, interval: 1, due: addDays(startOfLocalDay(now), 1).toISOString(), reps: 1, lapses: 0 },
  };
  next = { ...next, cards: [...next.cards, card] };
  return logEvent(next, "fact_remembered", { source: !!card.attribution, quantity: !!quantity(answer) }, now);
}

/** Every fact you looked up, newest first. The card id order is creation order within the set. */
export function lookedUpFacts(lib: Library): Card[] {
  const idx = new Map(lib.cards.map((c, i) => [c.id, i]));
  return lib.cards.filter(isLookup).sort((a, b) => idx.get(b.id)! - idx.get(a.id)!);
}

/** A short answer or a quantity is typed from memory; a longer one is recalled, revealed and self-graded. */
export function lookupExercise(card: Card): Exercise {
  const answer = card.answer ?? "";
  if (quantity(answer) || wordCount(answer) <= 4) {
    return { id: newId(), cardIds: [card.id], projectId: card.projectId, type: "type", prompt: card.question ?? card.statement, accepted: [answer], answer };
  }
  return genFlash(card);
}

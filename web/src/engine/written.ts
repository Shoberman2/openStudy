// Model-written concept questions (spec 13.6): which lessons need them, what the writer gets, and
// how its answer is applied. The writer itself lives in lib/ai.ts (server) and on iOS (on device).
import { isConcept } from "./exercises";
import { logEvent } from "./library";
import { normalizeAnswer } from "./text";
import type { Library } from "./types";

export const WRITER_MAX_CARDS = 14;

export type WrittenConcept = { id: string; concept: string; question: string; answer: string; distractors: string[]; falseStatement: string };

const factCards = (lib: Library, lessonId: string) => lib.cards.filter((c) => c.lessonId === lessonId && c.kind === "fact" && !c.term);

/** A theme lesson that a writer has not tried yet and that is mostly not concept cards. */
export function needsWrittenConcepts(lib: Library, lessonId: string): boolean {
  const lesson = lib.lessons.find((l) => l.id === lessonId);
  if (!lesson || lesson.kind !== "theme" || lesson.conceptsWritten) return false;
  const facts = factCards(lib, lessonId);
  return facts.length > 0 && facts.filter(isConcept).length * 2 < facts.length;
}

export function writerInput(lib: Library, lessonId: string): { id: string; text: string }[] {
  return factCards(lib, lessonId)
    .slice(0, WRITER_MAX_CARDS)
    .map((c) => ({ id: c.id, text: c.statement }));
}

/** Applies what the writer returned; always marks the lesson so it is never held up twice. */
export function applyWrittenConcepts(lib: Library, lessonId: string, written: WrittenConcept[], source: "device" | "server" | "none", now: Date = new Date()): Library {
  const allowed = new Set(writerInput(lib, lessonId).map((c) => c.id));
  const byId = new Map<string, WrittenConcept>();
  for (const w of written) {
    if (!allowed.has(w.id) || byId.has(w.id) || !w.question?.trim() || !w.answer?.trim()) continue;
    const own = normalizeAnswer(w.answer);
    const wrong = [...new Map((w.distractors ?? []).filter((d) => d?.trim() && normalizeAnswer(d) !== own).map((d) => [normalizeAnswer(d), d.trim()])).values()];
    if (wrong.length < 3) continue;
    byId.set(w.id, { ...w, distractors: wrong.slice(0, 3) });
  }
  const next: Library = {
    ...lib,
    lessons: lib.lessons.map((l) => (l.id === lessonId ? { ...l, conceptsWritten: true } : l)),
    cards: lib.cards.map((c) => {
      const w = byId.get(c.id);
      if (!w) return c;
      return { ...c, concept: w.concept.trim() || c.concept, question: w.question.trim(), answer: w.answer.trim(), distractors: w.distractors, falseStatement: w.falseStatement?.trim() || c.falseStatement };
    }),
  };
  return logEvent(next, "questions_written", { source, count: byId.size, lessonId }, now);
}

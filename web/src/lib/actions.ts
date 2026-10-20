import sampleJson from "@/data/sample-library.json";
import { orderByPageNumber } from "@/engine/grouping";
import { addSample, logEvent } from "@/engine/library";
import { review } from "@/engine/srs";
import type { ClassPage } from "@/engine/classbuilder";
import type { Grade, Library, Page } from "@/engine/types";
import { addXP, sessionXP } from "@/engine/xp";
import type { SessionSummary } from "@/components/exercise/SessionPlayer";

export const sample = sampleJson as unknown as Parameters<typeof addSample>[1];

export function withSample(lib: Library): Library {
  return addSample(lib, sample);
}

export function applyGrades(lib: Library, grades: Record<string, Grade>, now = new Date()): Library {
  return { ...lib, cards: lib.cards.map((c) => (grades[c.id] ? { ...c, srs: review(c.srs, grades[c.id], now) } : c)) };
}

export function finishLesson(lib: Library, lessonId: string, s: SessionSummary, now = new Date()): { lib: Library; xp: number } {
  const xp = sessionXP({ correctFirst: s.correctFirst, applyCorrect: s.applyCorrect, mistakes: s.mistakes, completed: true });
  let next: Library = {
    ...lib,
    lessons: lib.lessons.map((l) => (l.id === lessonId ? { ...l, sessions: l.sessions + 1, level: Math.min(5, l.level + 1) } : l)),
    stats: addXP(lib.stats, xp, now),
  };
  next = logEvent(next, "session_done", { accuracy: Math.round(s.accuracy * 100) / 100, seconds: s.seconds, xp, lessonId }, now);
  return { lib: next, xp };
}

export function finishPractice(lib: Library, s: SessionSummary, count: number, now = new Date()): { lib: Library; xp: number } {
  const xp = sessionXP({ correctFirst: s.correctFirst, applyCorrect: 0, mistakes: s.mistakes, completed: true });
  let next: Library = { ...lib, stats: addXP(lib.stats, xp, now) };
  next = logEvent(next, "review_done", { count, accuracy: Math.round(s.accuracy * 100) / 100, seconds: s.seconds, xp }, now);
  return { lib: next, xp };
}

/** Builder input, in page order when the screenshots carry page numbers (spec 10.5). */
export function toBuildPages(pages: Page[]): ClassPage[] {
  return orderByPageNumber(pages).map((p) => ({
    id: p.id,
    text: p.text,
    header: p.header,
    heading: p.heading,
    kind: p.kind,
    sourceName: p.sourceName,
    sourceIndex: p.sourceIndex,
    sourceTitle: p.sourceTitle,
    createdAt: p.createdAt,
    words: p.words,
    image: p.image,
    verbatim: p.verbatim ?? (p.kind === "note" && !!p.suggestedAuthor),
  }));
}

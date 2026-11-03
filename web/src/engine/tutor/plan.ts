// A study plan from spaced retrieval and the learner's mastery (spec 15.6). Deterministic.
import { attemptsFor, masteryScore, nextLevel, weakest, type Mastery } from "./adaptive";

export type PlanDay = { day: number; minutes: number; concept: string; level: number; activity: string; why: string };
export type StudyPlan = { topic: string; days: number; minutesPerDay: number; schedule: PlanDay[]; focus: string[] };

/** Expanding gaps: the same idea returns just as it starts to fade. */
const REVIEW_GAPS = [1, 3, 7, 14];

export function buildStudyPlan(topic: string, days: number, minutesPerDay: number, mastery: Mastery, concepts: string[] = []): StudyPlan {
  const known = weakest(mastery).filter((w) => w.score < 0.8).map((w) => w.concept);
  const focus = [...new Set([...known, ...concepts, topic])].slice(0, 6);
  const schedule: PlanDay[] = [];
  const add = (day: number, concept: string, activity: string, why: string) => {
    if (day > days) return;
    const attempts = attemptsFor(mastery, concept);
    schedule.push({ day, minutes: minutesPerDay, concept, level: nextLevel(attempts).level, activity, why });
  };
  focus.forEach((concept, i) => {
    // New ideas start a day apart so no single day carries more than one first lesson.
    const start = 1 + i;
    const score = masteryScore(attemptsFor(mastery, concept));
    add(start, concept, score > 0 ? "Quiz, then a worked problem on anything missed" : "Visual explanation, then a short quiz", score > 0 ? "You have tried this: start by recalling it." : "First contact: see it, then test it.");
    for (const gap of REVIEW_GAPS) add(start + gap, concept, gap >= 7 ? "Mixed quiz from memory" : "Flashcards from memory, then two questions", `Spaced review, ${gap} day${gap === 1 ? "" : "s"} after the first session.`);
  });
  schedule.sort((a, b) => a.day - b.day);
  return { topic, days, minutesPerDay, schedule, focus };
}

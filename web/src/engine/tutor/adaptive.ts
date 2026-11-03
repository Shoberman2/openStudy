// Explicit mastery per concept and a difficulty anyone can read (spec 15.4). Pure: the web keeps the
// state in localStorage, MCP clients pass it in. Nothing here is hidden from the learner.
import type { FollowupsBlock } from "./blocks";

export type Attempt = { concept: string; difficulty: number; correct: boolean; at: string };
export type Mastery = { attempts: Attempt[] };

export const EMPTY_MASTERY: Mastery = { attempts: [] };
/** Kept per learner; old attempts stop mattering long before this. */
export const MAX_ATTEMPTS = 200;
export const WINDOW = 5;
const UP = 0.8;
const DOWN = 0.4;
/** Attempts at a level before moving, so one lucky answer does not change it. */
const MIN_EVIDENCE = 3;
export const START_LEVEL = 2;

const key = (c: string) => c.trim().toLowerCase();
const clamp = (v: number) => Math.max(1, Math.min(5, v));

export function record(m: Mastery, a: Attempt): Mastery {
  return { attempts: [...m.attempts, a].slice(-MAX_ATTEMPTS) };
}

export function attemptsFor(m: Mastery, concept: string): Attempt[] {
  return m.attempts.filter((a) => key(a.concept) === key(concept));
}

/**
 * 0 to 1. Recent answers count more, and a right answer to a hard question counts for more than a right
 * answer to an easy one, while a wrong answer to a hard question costs less than a wrong easy one.
 */
export function masteryScore(attempts: Attempt[]): number {
  if (!attempts.length) return 0;
  let got = 0;
  let total = 0;
  attempts.slice(-20).forEach((a, i, all) => {
    const recency = 0.85 ** (all.length - 1 - i);
    const weight = recency * (a.correct ? 0.5 + a.difficulty / 5 : 1.1 - a.difficulty / 10);
    total += weight;
    if (a.correct) got += weight;
  });
  // Few attempts cannot prove mastery however good they are.
  return (got / total) * Math.min(1, attempts.length / MIN_EVIDENCE);
}

export type Level = { level: number; reason: string; direction: "up" | "down" | "hold" | "start" };

/** The next difficulty for a concept, with the plain sentence the quiz shows. */
export function nextLevel(attempts: Attempt[]): Level {
  if (!attempts.length) return { level: START_LEVEL, direction: "start", reason: `Starting at level ${START_LEVEL} of 5.` };
  const recent = attempts.slice(-WINDOW);
  const current = recent[recent.length - 1].difficulty;
  const right = recent.filter((a) => a.correct).length;
  const rate = right / recent.length;
  const seen = `${right} of your last ${recent.length}`;
  if (recent.length < MIN_EVIDENCE) return { level: current, direction: "hold", reason: `Staying at level ${current}: ${seen} so far.` };
  if (rate >= UP && current < 5) return { level: clamp(current + 1), direction: "up", reason: `Moved up to level ${current + 1}: you got ${seen} right.` };
  if (rate <= DOWN && current > 1) return { level: clamp(current - 1), direction: "down", reason: `Moved down to level ${current - 1}: you got ${seen} right.` };
  return { level: current, direction: "hold", reason: `Staying at level ${current}: you got ${seen} right.` };
}

/** Concepts weakest first, so plans and follow-ups start with what needs work. */
export function weakest(m: Mastery): { concept: string; score: number; attempts: number }[] {
  const names = new Map<string, string>();
  for (const a of m.attempts) names.set(key(a.concept), a.concept);
  return [...names.values()]
    .map((concept) => {
      const list = attemptsFor(m, concept);
      return { concept, score: masteryScore(list), attempts: list.length };
    })
    .sort((a, b) => a.score - b.score || a.concept.localeCompare(b.concept));
}

/** What to do next after a quiz, decided from the answers, not guessed. */
export function adaptiveFollowups(concept: string, attempts: Attempt[], missedStem?: string): FollowupsBlock {
  const { direction, level } = nextLevel(attempts);
  const items: FollowupsBlock["items"] = [];
  if (missedStem) items.push({ label: "Walk me through the one I missed", prompt: `Walk me through this step by step: ${missedStem}`.slice(0, 300) });
  if (direction === "down" || missedStem) items.push({ label: "Show me a picture of it", prompt: `Show me a visual explanation of ${concept}` });
  items.push({
    label: direction === "up" ? `Try level ${level}` : `More at level ${level}`,
    prompt: `Quiz me on ${concept} at level ${level}`,
  });
  if (direction !== "down") items.push({ label: "Make flashcards", prompt: `Make flashcards for ${concept}` });
  return { type: "followups", items: items.slice(0, 4) };
}

/** Parses client-supplied mastery; anything malformed is simply ignored. */
export function readAttempts(raw: unknown): Attempt[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Attempt => {
      const o = a as Partial<Attempt> | null;
      return !!o && typeof o.concept === "string" && typeof o.correct === "boolean" && Number.isInteger(o.difficulty) && o.difficulty! >= 1 && o.difficulty! <= 5;
    })
    .slice(-MAX_ATTEMPTS)
    .map((a) => ({ concept: a.concept.slice(0, 80), difficulty: a.difficulty, correct: a.correct, at: String(a.at ?? "") }));
}

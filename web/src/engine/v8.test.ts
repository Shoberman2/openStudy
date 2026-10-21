import { describe, expect, it } from "vitest";
import { emptyLibrary } from "./library";
import { buildSession } from "./session";
import { newSrs } from "./srs";
import type { Card, Lesson, Library, Profile } from "./types";
import { seeded } from "./util";
import { applyWrittenConcepts, needsWrittenConcepts, writerInput } from "./written";

const NOW = new Date("2026-10-21T12:00:00Z");
const profile: Profile = { onboarded: true, bringing: ["books"], goals: ["ideas"], practice: ["tap"], dailyGoalXP: 20 };
const lesson: Lesson = { id: "l1", projectId: "p", title: "Sleep", summary: "", kind: "theme", order: 0, level: 0, sessions: 0 };
const card = (i: number, extra: Partial<Card> = {}): Card => ({
  id: `c${i}`,
  lessonId: "l1",
  projectId: "p",
  kind: "fact",
  statement: `Statement number ${i} talks about something important here.`,
  cloze: "important",
  question: "",
  answer: "",
  distractors: ["trivial", "minor", "small"],
  falseStatement: `Statement number ${i} talks about something trivial here.`,
  srs: newSrs(NOW),
  ...extra,
});
const lib = (cards: Card[], l: Partial<Lesson> = {}): Library => ({ ...emptyLibrary(), lessons: [{ ...lesson, ...l }], cards });
const written = (id: string, wrong = ["Less sleep", "More stress", "Bad mood"]) => ({ id, concept: "Sleep", question: "Why does sleep matter?", answer: "It fixes memory", distractors: wrong, falseStatement: "Sleep wastes time." });

describe("model-written concept questions (13.6)", () => {
  it("asks for lessons that are mostly not concept cards, once", () => {
    const cards = Array.from({ length: 4 }, (_, i) => card(i));
    expect(needsWrittenConcepts(lib(cards), "l1")).toBe(true);
    expect(needsWrittenConcepts(lib(cards, { conceptsWritten: true }), "l1")).toBe(false);
    expect(needsWrittenConcepts(lib(cards, { kind: "quotes" }), "l1")).toBe(false);
    const half = cards.map((c, i) => (i < 2 ? { ...c, concept: "Sleep", question: "Q?", answer: "A" } : c));
    expect(needsWrittenConcepts(lib(half), "l1")).toBe(false);
    expect(needsWrittenConcepts(lib(cards.map((c) => ({ ...c, term: "t", definition: "d" }))), "l1")).toBe(false);
  });

  it("sends at most 14 cards", () => {
    expect(writerInput(lib(Array.from({ length: 20 }, (_, i) => card(i))), "l1")).toHaveLength(14);
  });

  it("applies good answers, keeps ids and SRS, and always marks the lesson", () => {
    const cards = [card(0), card(1), card(2)];
    const next = applyWrittenConcepts(lib(cards), "l1", [written("c0"), written("c1", ["It fixes memory", "Less sleep", "Less sleep"]), written("nope")], "server", NOW);
    const [a, b] = next.cards;
    expect(a).toMatchObject({ id: "c0", concept: "Sleep", question: "Why does sleep matter?", answer: "It fixes memory", srs: cards[0].srs });
    expect(a.distractors).toEqual(["Less sleep", "More stress", "Bad mood"]);
    expect(b.question).toBe("");
    expect(next.lessons[0].conceptsWritten).toBe(true);
    expect(next.events.at(-1)).toMatchObject({ name: "questions_written", props: { source: "server", count: 1 } });
    expect(applyWrittenConcepts(lib(cards), "l1", [], "none", NOW).lessons[0].conceptsWritten).toBe(true);
  });

  it("theme sessions have no word bank, match or typed blank", () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(i, i < 6 ? { concept: "Sleep", question: `Q${i}?`, answer: `Answer ${i}`, distractors: [`W${i}a`, `W${i}b`, `W${i}c`] } : {}));
    for (const level of [0, 1, 2, 3, 4])
      for (const seed of [1, 2, 3]) {
        const types = buildSession({ ...lesson, level }, cards, profile, NOW, seeded(seed)).map((e) => e.type);
        expect(types.filter((t) => t === "bank" || t === "match" || t === "type")).toEqual([]);
      }
  });
});

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { study, type EventRow } from "./analytics";
import { buildProject } from "./classbuilder";
import { conceptCards, conceptQuestion, lowerFirst } from "./concepts";
import { cleanProps } from "./events";
import { emptyLibrary, materialize, setFocus } from "./library";
import { buildSession, conceptExercises } from "./session";
import { newSrs } from "./srs";
import type { BuildResult, FactDraft } from "./builder";
import type { Card, Lesson, Library, Profile } from "./types";
import { seeded } from "./util";

const NOW = new Date("2026-10-21T12:00:00Z");
const profile: Profile = { onboarded: true, bringing: ["books"], goals: ["ideas"], practice: ["tap"], dailyGoalXP: 20 };
const fact = (statement: string): FactDraft => ({ statement, cloze: statement.split(" ")[1], question: "", answer: "", distractors: [], falseStatement: statement });

describe("offline concept questions (13.3)", () => {
  it("asks why for a because sentence", () => {
    expect(conceptQuestion("Most people waste their time because they never plan their day.")).toEqual({
      question: "Most people waste their time. Why?",
      answer: "They never plan their day",
    });
  });

  it("asks what something leads to, singular and plural", () => {
    expect(conceptQuestion("Stress causes poor sleep in adults.")).toEqual({ question: "What does stress cause?", answer: "Poor sleep in adults" });
    expect(conceptQuestion("Short naps improve memory and mood.")).toEqual({ question: "What do short naps improve?", answer: "Memory and mood" });
    expect(conceptQuestion("Regular exercise leads to better focus at work.")?.question).toBe("What does regular exercise lead to?");
  });

  it("skips pronouns, commas and long halves", () => {
    expect(conceptQuestion("It causes poor sleep in adults.")).toBeNull();
    expect(conceptQuestion("In plants, light causes the leaves to open.")).toBeNull();
    expect(conceptQuestion("Stress causes sleep.")).toBeNull();
  });

  it("covers instead, if, the X is and define sentences", () => {
    expect(conceptQuestion("Instead of condemning people, let's try to understand them.")).toEqual({
      question: "What should you do instead of condemning people?",
      answer: "Let's try to understand them",
    });
    expect(conceptQuestion("Ask questions instead of giving direct orders.")).toEqual({ question: "What should you do instead of giving direct orders?", answer: "Ask questions" });
    expect(conceptQuestion("If you are wrong, admit it quickly and emphatically.")).toEqual({ question: "If you are wrong, then what?", answer: "Admit it quickly and emphatically" });
    expect(conceptQuestion("The deepest urge in human nature is the desire to be important.")).toEqual({
      question: "What is the deepest urge in human nature?",
      answer: "The desire to be important",
    });
    expect(conceptQuestion("Loss is nothing else but change, and change is Nature's delight.")).toEqual({ question: "What is loss?", answer: "Nothing else but change" });
    expect(conceptQuestion("Nucleus: holds the cell's DNA and controls its activity.")).toBeNull();
    expect(conceptQuestion("Very little is needed to make a happy life.")).toBeNull();
  });

  it("builds the sample book's concept cards", () => {
    const lib = JSON.parse(fs.readFileSync(new URL("../../../shared/sample-library.json", import.meta.url), "utf8")) as Library;
    const pages = lib.pages.filter((p) => p.projectId === "smpcarnegi");
    const cards = buildProject({ title: "How to Win Friends and Influence People", type: "book" }, pages.map((p) => ({ id: p.id, text: p.text }))).lessons.flatMap((l) => l.cards);
    const concept = cards.filter((c) => c.concept);
    expect(concept).toHaveLength(7);
    expect(concept.map((c) => [c.question, c.answer])).toContainEqual(["What is the deepest urge in human nature?", "The desire to be important"]);
    expect(concept.map((c) => [c.question, c.answer])).toContainEqual(["If you are wrong, then what?", "Admit it quickly and emphatically"]);
  });

  it("keeps acronyms and mixed case names", () => {
    expect(lowerFirst("DNA damage")).toBe("DNA damage");
    expect(lowerFirst("McDonald's menu")).toBe("McDonald's menu");
    expect(lowerFirst("Stress")).toBe("stress");
  });

  const sentences = [
    "Stress causes poor sleep in adults.",
    "Short naps improve memory and mood.",
    "Most people waste their time because they never plan their day.",
    "Regular exercise leads to better focus at work.",
  ];

  it("needs 4 matches in the project", () => {
    const three: BuildResult = { lessons: [{ title: "Sleep", summary: "", cards: sentences.slice(0, 3).map(fact) }], quotes: [] };
    expect(conceptCards(three)).toBe(three);
  });

  it("turns matches into concept cards with 3 same-kind wrong answers", () => {
    const r = conceptCards({ lessons: [{ title: "Sleep", summary: "", cards: [...sentences.map(fact), fact("People sleep less in big cities than in towns.")] }], quotes: [] });
    const [stress, , waste] = r.lessons[0].cards;
    expect(stress.concept).toBe("Sleep");
    expect(stress.question).toBe("What does stress cause?");
    expect(stress.distractors).toHaveLength(3);
    expect(stress.distractors).not.toContain("Poor sleep in adults");
    expect(waste.question).toBe("Most people waste their time. Why?");
    // A sentence with no pattern stays a plain fact card.
    expect(r.lessons[0].cards[4].concept).toBeUndefined();
  });

  it("runs inside buildProject", () => {
    const text = [...sentences, "Daily light exposure increases alertness in the morning.", "Caffeine late in the day reduces deep sleep for hours."].join(" ");
    const r = buildProject({ title: "Sleep Book", type: "book" }, [{ id: "p1", text }]);
    expect(r.lessons.flatMap((l) => l.cards).filter((c) => c.concept).length).toBeGreaterThanOrEqual(4);
  });
});

describe("session mix (13.4)", () => {
  const lesson: Lesson = { id: "l1", projectId: "p", title: "Sleep", summary: "", kind: "theme", order: 0, level: 0, sessions: 0 };
  const card = (i: number, concept: boolean): Card => ({
    id: `c${i}`,
    lessonId: "l1",
    projectId: "p",
    kind: "fact",
    statement: `Statement number ${i} talks about something important here.`,
    cloze: "important",
    question: concept ? `Concept question ${i}?` : "",
    answer: concept ? `Answer ${i}` : "",
    distractors: concept ? [`Wrong ${i}a`, `Wrong ${i}b`, `Wrong ${i}c`] : [],
    falseStatement: `Statement number ${i} talks about something trivial here.`,
    ...(concept ? { concept: "Sleep" } : {}),
    srs: newSrs(NOW),
  });

  it("multiple choice asks concept questions first", () => {
    const cards = [...Array.from({ length: 6 }, (_, i) => card(i, false)), ...Array.from({ length: 4 }, (_, i) => card(10 + i, true))];
    for (const seed of [1, 2, 3, 4, 5]) {
      const ex = buildSession(lesson, cards, profile, NOW, seeded(seed));
      const mcs = ex.filter((e) => e.type === "mc");
      expect(mcs.length).toBeGreaterThan(0);
      expect(cards.find((c) => c.id === mcs[0].cardIds[0])?.concept).toBe("Sleep");
      expect(ex.some((e) => e.type === "match")).toBe(false);
      expect(conceptExercises(ex, cards)).toBeGreaterThan(0);
    }
  });
});

describe("choose a focus (13.5)", () => {
  const lib = (): Library => {
    const built = materialize(
      "p",
      {
        lessons: ["A", "B", "C"].map((t) => ({ title: t, summary: `${t} summary`, cards: [fact(`The ${t} idea is something worth knowing well.`)] })),
        quotes: [{ text: "Quote one is here and long enough to count." }],
      },
      [{ text: "Quote one is here and long enough to count." }],
      { now: NOW },
    );
    const base = emptyLibrary();
    return {
      ...base,
      projects: [{ id: "p", title: "Book", color: "blue", createdAt: NOW.toISOString(), focus: "ideas", quotesAsked: true }],
      lessons: built.lessons,
      cards: built.cards,
    };
  };

  it("puts focused lessons first and keeps Quotes after the first one", () => {
    const l = lib();
    const [a, , b, c] = l.lessons.slice().sort((x, y) => x.order - y.order);
    expect([a.title, b.title, c.title]).toEqual(["A", "B", "C"]);
    const next = setFocus(l, "p", [c.id, b.id], NOW);
    const titles = next.lessons.slice().sort((x, y) => x.order - y.order).map((x) => x.title);
    expect(titles).toEqual(["B", "Quotes", "C", "A"]);
    expect(next.projects[0]).toMatchObject({ focusLessons: [b.id, c.id], focusAsked: true });
    expect(next.events.at(-1)).toMatchObject({ name: "focus_set", props: { offered: 3, chosen: 2 } });
  });

  it("everything keeps the order and records chosen 0", () => {
    const l = lib();
    const next = setFocus(l, "p", [], NOW);
    expect(next.lessons.slice().sort((x, y) => x.order - y.order).map((x) => x.title)).toEqual(["A", "Quotes", "B", "C"]);
    expect(next.projects[0].focusLessons).toEqual([]);
    expect(next.events.at(-1)?.props?.chosen).toBe(0);
  });

  it("sends focus counts and reports them in the study tool", () => {
    expect(cleanProps({ offered: 4, chosen: 2, concepts: 6, projectId: "p" })).toEqual({ offered: 4, chosen: 2, concepts: 6 });
    const row = (name: string, props: EventRow["props"]): EventRow => ({ t: "2026-10-21T10:00:00Z", install_id: "i", user_id: null, platform: "web", name, props });
    const s = study([row("focus_set", { offered: 4, chosen: 2 }), row("focus_set", { offered: 3, chosen: 0 }), row("session_start", { concepts: 6 })], NOW, 30);
    expect(s.focus).toEqual({ set: 2, everything: 1, avgChosen: 2, avgOffered: 3.5 });
    expect(s.avgConceptQuestions).toBe(6);
  });
});

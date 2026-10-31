import { describe, expect, it } from "vitest";
import { genPageMC, pageMates, type Exercise } from "./exercises";
import { emptyLibrary } from "./library";
import { buildFromCards, buildPractice, buildSession, keyBlanks, slotPlan } from "./session";
import { buildProject } from "./classbuilder";
import { conceptQuestion } from "./concepts";
import { materialize } from "./library";
import { newSrs } from "./srs";
import type { Card, Lesson, Profile } from "./types";
import { seeded } from "./util";
import { writerInput, writerPages } from "./written";

const NOW = new Date("2026-10-23T12:00:00Z");
const profile: Profile = { onboarded: true, bringing: ["books"], goals: ["ideas"], practice: ["tap"], dailyGoalXP: 20 };
const lesson: Lesson = { id: "l1", projectId: "p", title: "Sleep", summary: "", kind: "theme", order: 0, level: 0, sessions: 0 };
const PAGES: Record<string, [string, string[]]> = {
  p1: ["l1", ["Sleep helps the brain store what you learned today.", "During deep sleep the brain replays new memories.", "Pulling an all nighter makes memories from the day fade."]],
  p2: ["l1", ["Caffeine blocks the signal that tells you to feel sleepy.", "A coffee after lunch can still keep you awake at night.", "Your body clears caffeine slowly over many hours."]],
  p3: ["l2", ["Morning light sets your body clock for the whole day.", "Screens at night trick the brain into thinking it is daytime.", "A steady wake up time makes falling asleep easier."]],
};
let n = 0;
const cards: Card[] = Object.entries(PAGES).flatMap(([pageId, [lessonId, lines]]) =>
  lines.map((statement) => ({ id: `c${n++}`, lessonId, projectId: "p", pageId, kind: "fact" as const, statement, cloze: statement.split(" ")[1], distractors: ["one", "two", "three"], falseStatement: `${statement} Not.`, srs: newSrs(NOW) })),
);
const onPage = (pageId: string, s: string) => PAGES[pageId][1].includes(s);
const ctx = (seed = 1) => ({ pool: cards, rand: seeded(seed) });
const mc = (e: Exercise | null) => {
  if (!e || e.type !== "mc") throw new Error("expected mc");
  return e;
};

describe("whole-page questions (13.7)", () => {
  it("finds a card's page mates in pool order", () => {
    expect(pageMates(cards[0], cards).map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(pageMates({ ...cards[0], pageId: undefined }, cards)).toEqual([]);
  });

  it("gist asks which idea goes with two lines of a page, with wrong answers from other pages", () => {
    const e = mc(genPageMC(cards[0], ctx(), "gist"));
    expect(e.form).toBe("gist");
    expect(e.prompt).toBe("These lines come from one page. Which idea goes with them?");
    expect(onPage("p1", e.answer)).toBe(true);
    expect(e.context).toHaveLength(2);
    expect(e.context).not.toContain(e.answer);
    expect(e.options).toHaveLength(4);
    expect(e.options.filter((o) => onPage("p1", o))).toEqual([e.answer]);
    // Other lessons first: the closest outsiders come from p3 before p2.
    expect(e.options.filter((o) => onPage("p3", o))).toHaveLength(3);
  });

  it("odd has exactly one option from another page, and it is the answer", () => {
    const e = mc(genPageMC(cards[3], ctx(), "odd"));
    expect(e.options.filter((o) => onPage("p2", o))).toHaveLength(3);
    expect(onPage("p2", e.answer)).toBe(false);
    expect(e.options).toContain(e.answer);
  });

  it("a form fails without enough mates", () => {
    const lone = { ...cards[0], id: "x", pageId: "solo" };
    expect(genPageMC(lone, { pool: [...cards, lone], rand: seeded(1) }, "odd")).toBeNull();
    expect(genPageMC({ ...cards[0], pageId: "p9" }, ctx(), "gist")).toBeNull();
  });

  it("the writer gets each card's page and the page text", () => {
    const lib = { ...emptyLibrary(), lessons: [lesson], cards, pages: [{ id: "p1", projectId: "p", kind: "screenshot" as const, text: "x".repeat(2000), createdAt: NOW.toISOString() }] };
    expect(writerInput(lib, "l1")[0]).toEqual({ id: "c0", text: cards[0].statement, pageId: "p1" });
    expect(writerPages(lib, "l1")).toEqual([{ id: "p1", text: "x".repeat(1200) }]);
  });
});

const HABITS = [
  "Habits are the compound interest of self-improvement. The same way that money multiplies through compound interest, the effects of your habits multiply as you repeat them. They seem to make little difference on any given day and yet the impact they deliver over the months and years can be enormous.",
  "You do not rise to the level of your goals. You fall to the level of your systems. Goals are about the results you want to achieve. Systems are about the processes that lead to those results. If you want better results, then forget about setting goals. Focus on your system instead.",
  "The most effective way to change your habits is to focus not on what you want to achieve, but on who you wish to become. Your identity emerges out of your habits. Every action you take is a vote for the type of person you wish to become.",
  "Environment is the invisible hand that shapes human behavior. People often choose products not because of what they are, but because of where they are. If you want to make a habit a big part of your life, make the cue a big part of your environment.",
  "The two-minute rule states that when you start a new habit, it should take less than two minutes to do. A new habit should not feel like a challenge. The point is to master the habit of showing up, because a habit must be established before it can be improved.",
  "We are more likely to repeat a behavior when the experience is satisfying. The first three laws of behavior change increase the odds that a behavior will be performed this time. The fourth law increases the odds that it will be repeated next time.",
];
const habits = () => {
  const built = materialize("P", buildProject({ title: "Atomic Habits", type: "book" }, HABITS.map((text, i) => ({ id: `h${i}`, text }))), [], { now: NOW });
  return built;
};
const isMC = (e: Exercise) => e.type === "mc" || e.type === "def-mc";
const isFill = (e: Exercise) => e.type === "bank" || e.type === "type" || e.type === "term-type";

describe("majority multiple choice, meaningful only (13.8)", () => {
  it("plans 6 multiple choice, 2 fill-ins and 2 others in a 10 question lesson", () => {
    for (const level of [0, 2, 4]) {
      const plan = slotPlan(level, 10, { apply: true, match: false }, seeded(level + 1));
      expect(plan.filter((s) => s === "M")).toHaveLength(6);
      expect(plan[0]).toBe("M");
      expect(plan.filter((s) => s === "bank" || s === "type")).toHaveLength(2);
    }
    expect(slotPlan(0, 10, { apply: false, match: false }, seeded(1)).filter((s) => s === "tf")).toHaveLength(2);
    expect(slotPlan(4, 10, { apply: true, match: false }, seeded(1))).toContain("apply");
    expect(slotPlan(4, 10, { apply: false, match: false }, seeded(1))).toContain("explain");
    expect(slotPlan(0, 10, { apply: false, match: true }, seeded(1))).toContain("match");
  });

  it("blanks a key word, never trivia, an everyday word or a word the sentence repeats", () => {
    const mk = (id: string, statement: string, cloze?: string): Card => ({ id, lessonId: "l1", projectId: "p", kind: "fact", statement, cloze, srs: newSrs(NOW) });
    const pool = [
      mk("a", "Compound interest makes small habits grow over many years.", "years"),
      mk("b", "Your habits shape your identity over time.", "identity"),
      mk("c", "Compound interest rewards patience with money."),
      mk("d", "Identity comes from repeated actions."),
      mk("e", "People want results without systems."),
      mk("f", "Results come from systems people build."),
      mk("g", "Earth is a planet and habits matter here and habits stay."),
      ...Array.from({ length: 4 }, (_, i) => mk(`z${i}`, `Unrelated filler sentence number ${i} about gardens.`)),
    ];
    const blankOf = keyBlanks(pool);
    // "years" is on one card only, so the blank moves to the key word on the most cards.
    expect(blankOf(pool[0])).toBe("habits");
    expect(blankOf(pool[1])).toBe("identity");
    // "people" is an everyday word; "results" and "systems" are shared.
    expect(["results", "systems"]).toContain(blankOf(pool[4]));
    // "habits" appears twice in this sentence and "Earth" only here.
    expect(blankOf(pool[6])).toBeUndefined();
    const wrong = blankOf.wrong(pool[1], "identity", 3);
    expect(wrong).toHaveLength(3);
    expect(wrong.some((w) => pool[1].statement.toLowerCase().includes(w))).toBe(false);
  });

  it("real lessons are mostly multiple choice, with fill-ins and no word-swap true or false", () => {
    const { lessons, cards: all } = habits();
    let mc = 0;
    let fill = 0;
    let total = 0;
    for (const l of lessons.filter((x) => x.kind === "theme"))
      for (const level of [0, 2, 4])
        for (let seed = 1; seed < 4; seed++) {
          const ex = buildSession({ ...l, level }, all, profile, NOW, seeded(seed), all, { projectType: "book" });
          total += ex.length;
          mc += ex.filter(isMC).length;
          fill += ex.filter(isFill).length;
          for (const e of ex) if (e.type === "tf") expect(all.find((c) => c.id === e.cardIds[0])!.concept).toBeTruthy();
        }
    expect(mc / total).toBeGreaterThanOrEqual(0.55);
    expect(fill / total).toBeGreaterThanOrEqual(0.1);
  });

  it("practice and review are mostly multiple choice and never use a word swap", () => {
    const due = cards.map((c) => ({ ...c, srs: { ...c.srs, state: "review" as const, due: "2026-10-01T00:00:00Z" } }));
    for (let seed = 1; seed < 6; seed++) {
      const ex = buildPractice(due, NOW, seeded(seed));
      expect(ex.every((e) => e.type === "mc" || e.type === "bank")).toBe(true);
      expect(ex.filter((e) => e.type === "mc").length * 2).toBeGreaterThan(ex.length);
    }
    expect(buildFromCards(due.slice(0, 4), due, seeded(1)).every((e) => e.type === "mc" || e.type === "bank")).toBe(true);
  });

  it("concept rules skip answers that teach the rejected half", () => {
    expect(conceptQuestion("People often choose products not because of what they are, but because of where they are.")).toBeNull();
    expect(conceptQuestion("The most effective way to change your habits is to focus not on what you want to achieve, but on who you wish to become.")).toBeNull();
    expect(conceptQuestion("Systems are about the processes that lead to those results.")).toBeNull();
    expect(conceptQuestion("If you want better results, then forget about setting goals.")).toEqual({ question: "If you want better results, then what?", answer: "Forget about setting goals" });
  });
});

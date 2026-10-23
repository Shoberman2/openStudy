import { describe, expect, it } from "vitest";
import { genPageMC, pageMates, type Exercise } from "./exercises";
import { emptyLibrary } from "./library";
import { buildFromCards, buildPractice, buildSession } from "./session";
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

  it("gist asks for the page's main point, with wrong answers from other pages", () => {
    const e = mc(genPageMC(cards[0], ctx(), "gist"));
    expect(e.form).toBe("gist");
    expect(e.prompt).toBe("What's the main point of the page these lines come from?");
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

  it("mate shows one line and asks which other line shares its page", () => {
    const e = mc(genPageMC(cards[6], ctx(), "mate"));
    expect(e.context).toEqual([cards[6].statement]);
    expect(e.answer).toBe(cards[7].statement);
    expect(e.options.filter((o) => onPage("p3", o))).toEqual([e.answer]);
  });

  it("a form fails without enough mates", () => {
    const lone = { ...cards[0], id: "x", pageId: "solo" };
    expect(genPageMC(lone, { pool: [...cards, lone], rand: seeded(1) }, "mate")).toBeNull();
    expect(genPageMC({ ...cards[0], pageId: "p9" }, ctx(), "gist")).toBeNull();
  });

  it("a lesson without concept cards mixes page forms instead of blanks", () => {
    const ex = buildSession(lesson, cards, profile, NOW, seeded(3), cards);
    const mcs = ex.filter((e) => e.type === "mc") as Extract<Exercise, { type: "mc" }>[];
    expect(mcs.length).toBeGreaterThan(2);
    expect(mcs.every((e) => !e.prompt.includes("____"))).toBe(true);
    expect(new Set(mcs.map((e) => e.form)).size).toBeGreaterThanOrEqual(3);
  });

  it("asks each page's gist and odd question once per session", () => {
    for (let seed = 1; seed < 8; seed++) {
      const ex = buildSession({ ...lesson, level: 2 }, cards, profile, NOW, seeded(seed), cards);
      const keys = ex.flatMap((e) => (e.type === "mc" && (e.form === "gist" || e.form === "odd") ? [`${e.form}:${cards.find((c) => c.id === e.cardIds[0])!.pageId}`] : []));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("concept questions and page questions take turns", () => {
    const withConcepts = cards.map((c, i) => (i % 3 === 0 && c.lessonId === "l1" ? { ...c, concept: "Sleep", question: `Why ${i}?`, answer: `Because ${i}`, distractors: ["Nope a", "Nope b", "Nope c"] } : c));
    const ex = buildSession(lesson, withConcepts, profile, NOW, seeded(5), withConcepts);
    const forms = ex.flatMap((e) => (e.type === "mc" ? [e.form] : []));
    expect(forms[0]).toBe("concept");
    expect(forms).toContain("gist");
    expect(forms.filter((f) => f === "concept").length).toBeLessThan(forms.length);
  });

  it("practice and review never use a word bank or typed blank", () => {
    const due = cards.map((c) => ({ ...c, srs: { ...c.srs, state: "review" as const, due: "2026-10-01T00:00:00Z" } }));
    for (let seed = 1; seed < 6; seed++) {
      const types = buildPractice(due, NOW, seeded(seed)).map((e) => e.type);
      expect(types.every((t) => t === "mc" || t === "tf")).toBe(true);
    }
    expect(buildFromCards(due.slice(0, 4), due, seeded(1)).map((e) => e.type)).toEqual(["mc", "tf", "mc", "tf"]);
  });

  it("the writer gets each card's page and the page text", () => {
    const lib = { ...emptyLibrary(), lessons: [lesson], cards, pages: [{ id: "p1", projectId: "p", kind: "screenshot" as const, text: "x".repeat(2000), createdAt: NOW.toISOString() }] };
    expect(writerInput(lib, "l1")[0]).toEqual({ id: "c0", text: cards[0].statement, pageId: "p1" });
    expect(writerPages(lib, "l1")).toEqual([{ id: "p1", text: "x".repeat(1200) }]);
  });
});

import { describe, expect, it } from "vitest";
import { checkTyped, quantity } from "./check";
import { emptyLibrary, exportLibrary, normalizeLibrary } from "./library";
import { LOOKED_UP_ID, lookedUpFacts, lookupExercise, rememberFact } from "./lookup";
import { buildPlan } from "./plan";
import { buildPractice, buildSession } from "./session";

const NOW = new Date(2026, 10, 28, 20, 0);
const TOMORROW = new Date(2026, 10, 29, 9, 0);

describe("Remember a Fact (spec 19)", () => {
  const lib0 = { ...emptyLibrary(), profile: { ...emptyLibrary().profile, onboarded: true } };
  let lib = rememberFact(lib0, { question: "How far away is the Moon?", answer: "About 238,900 miles", source: "https://example.com/moon" }, NOW, "f1");
  lib = rememberFact(lib, { question: "Who wrote Grokking Algorithms?", answer: "Aditya Bhargava" }, NOW, "f2");
  lib = rememberFact(lib, { question: "Why is the sky blue?", answer: "Air scatters short blue wavelengths of sunlight more than long red ones" }, NOW, "f3");

  it("files facts in one Looked Up set, newest first, once", () => {
    expect(lib.projects.filter((p) => p.id === LOOKED_UP_ID)).toHaveLength(1);
    expect(lookedUpFacts(lib).map((c) => c.id)).toEqual(["f3", "f2", "f1"]);
    expect(lookedUpFacts(lib)[2].attribution).toBe("https://example.com/moon");
    expect(rememberFact(lib, { question: " ", answer: "x" }, NOW)).toBe(lib);
  });

  it("first quizzes a fact tomorrow, in practice and on Today, never as a topic to learn", () => {
    expect(buildPractice(lib.cards, NOW)).toHaveLength(0);
    const ex = buildPractice(lib.cards, TOMORROW, () => 0.5);
    expect(new Set(ex.flatMap((e) => e.cardIds))).toEqual(new Set(["f1", "f2", "f3"]));
    const today = buildPlan(lib, TOMORROW).days[0];
    expect(today.items.some((it) => it.kind === "review")).toBe(true);
    expect(today.items.some((it) => it.kind !== "review" && "lessonId" in it)).toBe(false);
  });

  it("types short answers and quantities, reveals long ones", () => {
    const [f3, f2, f1] = lookedUpFacts(lib);
    expect(lookupExercise(f1).type).toBe("type");
    expect(lookupExercise(f2).type).toBe("type");
    expect(lookupExercise(f3).type).toBe("flash");
    const lesson = lib.lessons.find((l) => l.projectId === LOOKED_UP_ID)!;
    expect(buildSession(lesson, lib.cards, lib.profile, NOW, () => 0.5).map((e) => e.type).sort()).toEqual(["flash", "type", "type"]);
  });

  it("gives typed quantities leeway, keeps years exact", () => {
    expect(quantity("About 238,900 miles")).toEqual({ n: 238900, unit: "miles" });
    expect(quantity("1969")).toBeNull();
    expect(checkTyped("239,000", "About 238,900 miles")).toBe("correct");
    expect(checkTyped("240000 miles", "About 238,900 miles")).toBe("correct");
    expect(checkTyped("250,000", "About 238,900 miles")).toBe("close");
    expect(checkTyped("300,000", "About 238,900 miles")).toBe("wrong");
    expect(checkTyped("238,900 km", "About 238,900 miles")).toBe("wrong");
    expect(checkTyped("8 billion", "8 billion people")).toBe("correct");
    expect(checkTyped("1968", "1969")).not.toBe("correct");
    expect(checkTyped("Aditya Bhargava", "Aditya Bhargava")).toBe("correct");
  });

  it("survives the v1 backup round trip", () => {
    const back = normalizeLibrary(JSON.parse(JSON.stringify(exportLibrary(lib))));
    expect(lookedUpFacts(back).map((c) => c.question)).toEqual(lookedUpFacts(lib).map((c) => c.question));
  });
});

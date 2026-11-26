import { describe, expect, it } from "vitest";
import { finishLesson, finishPractice } from "../lib/actions";
import { checkTyped } from "./check";
import { genMC } from "./exercises";
import { buildProject } from "./classbuilder";
import { emptyLibrary } from "./library";
import { buildConnection, buildFromCards, buildPractice, buildPracticeTest, buildSession, keyBlanks } from "./session";
import { newSrs } from "./srs";
import type { Card, Lesson, Project } from "./types";
import { addDays } from "./util";

const now = new Date(2026, 10, 23, 10);
const profile = emptyLibrary().profile;
const lesson: Lesson = { id: "l1", projectId: "p", title: "Vectors", summary: "", kind: "theme", order: 0, level: 0, sessions: 0 };
const project: Project = { id: "p", color: "blue", title: "R", createdAt: now.toISOString(), focus: "ideas", quotesAsked: true, type: "class" };
const fact = (id: string, statement: string, extra: Partial<Card> = {}): Card => ({
  id, statement, kind: "fact", lessonId: lesson.id, projectId: project.id, srs: newSrs(now), ...extra,
});
const defs = [
  ["head(df)", "Returns the first six rows"],
  ["tail(df)", "Returns the last six rows"],
  ["c()", "Combines values into a vector"],
  ["filter()", "Keeps rows satisfying a test"],
  ["select()", "Keeps the columns you name"],
  ["NA", "Marks a missing value in R"],
].map(([term, definition], i) => fact(`def${i}`, `${term}: ${definition}.`, { term, definition, answer: term }));

describe("drill-first session selection", () => {
  it.each(["class", "other", "book"] as const)("recalls something already recognized at both early levels (%s)", (projectType) => {
    for (const level of [0, 1]) {
      for (const draw of [0.1, 0.4, 0.7, 0.9]) {
        const questions = buildSession({ ...lesson, level }, defs, { ...profile, practice: ["flash"] }, now, () => draw, defs, { projectType });
        const recall = questions.filter((q) => q.type === "term-type");
        expect(recall).toHaveLength(1);
        const earlier = questions.slice(0, questions.indexOf(recall[0]));
        expect(earlier.some((q) => ["def-mc", "mc", "match"].includes(q.type) && q.cardIds.includes(recall[0].cardIds[0]))).toBe(true);
        expect(questions[0].type).not.toBe("term-type");
      }
    }
  });

  it("leaves recognition and recall unchanged when no definition can be used", () => {
    const loner = [defs[0]];
    expect(buildSession(lesson, loner, profile, now, () => 0.5, loner, { projectType: "class" })).toEqual([]);
    const questions = buildSession({ ...lesson, level: 2 }, defs, profile, now, () => 0, defs, { projectType: "book" });
    expect(questions.filter((q) => q.type === "term-type")).toHaveLength(1);
  });

  it.each(["class", "other"] as const)("drops page forms and generic blanks and can serve five questions (%s)", (projectType) => {
    const generic = [
      fact("weak1", "Press the blue button to continue.", { cloze: "blue", pageId: "a" }),
      fact("weak2", "The optional memo has a shiny cover.", { cloze: "shiny", pageId: "a" }),
      fact("weak3", "Never push the cart around a corner.", { cloze: "cart", pageId: "a" }),
      fact("weak4", "Dinner starts when the music stops.", { cloze: "dinner", pageId: "b" }),
    ];
    const lessonDefs = defs.slice(0, 2);
    const cards = [...lessonDefs, ...generic];
    const pool = [...cards, ...defs.slice(2).map((c) => ({ ...c, lessonId: "other" }))];
    const bound = fact("bound", "A linear scan takes O(n) time.", { cloze: "scan" });
    cards.push(bound);
    pool.push(bound);
    const questions = buildSession(lesson, cards, profile, now, () => 0.9, pool, { projectType });
    expect(questions).toHaveLength(5);
    expect(questions.flatMap((q) => q.cardIds).some((id) => id.startsWith("weak"))).toBe(false);
    expect(questions.some((q) => q.type === "mc" && q.answer === "O(n)" && q.options.every((o) => o.startsWith("O(")))).toBe(true);
    const book = buildSession(lesson, cards, profile, now, () => 0.9, pool, { projectType: "book" });
    expect(book.some((q) => q.type === "mc" && (q.form === "gist" || q.form === "odd"))).toBe(true);
    expect(book.length).toBeGreaterThan(questions.length);
  });

  it("filters class questions in review, practice tests, and mixed-project practice", () => {
    const weak = fact("weak", "The optional memo has a shiny cover.", { cloze: "shiny", srs: { ...newSrs(now), state: "review" } });
    const book = fact("book", "Press the blue button to continue.", { cloze: "blue", projectId: "book", lessonId: "book-lesson", srs: weak.srs });
    const bookLesson = { ...lesson, id: book.lessonId, projectId: book.projectId };
    const cards = [weak, book];
    const opts = { projectTypes: new Map([[project.id, "class"], [book.projectId, "book"]] as const) };
    const rand = () => 0.15;
    for (const exercises of [
      buildPractice(cards, now, rand, 12, opts),
      buildPracticeTest([lesson, bookLesson], cards, rand, 20, opts),
      buildConnection(lesson.id, bookLesson.id, cards, now, rand, 10, opts),
      buildFromCards(cards, cards, rand, opts),
    ]) {
      expect(exercises.length).toBeGreaterThan(0);
      expect(exercises.every((q) => q.projectId === book.projectId)).toBe(true);
    }
  });

  it("builds procedural definitions from class prose and keeps the book builder", () => {
    const text = "Merge sort splits the array in half and then merges the sorted halves.";
    const pages = [{ id: "p1", text, kind: "doc" as const }];
    expect(buildProject({ title: "Sorting", type: "class" }, pages).lessons[0].cards[0].term).toBe("Merge sort");
    expect(buildProject({ title: "Sorting", type: "book" }, pages).lessons.flatMap((l) => l.cards).every((c) => !c.term)).toBe(true);
    const weak = fact("weak", "Yellow is a common color.", { cloze: "common" });
    expect(keyBlanks([weak])(weak)).toBeUndefined();
  });
});

describe("syntax checking", () => {
  it.each([
    ["head( df );", "head(df)", "correct"],
    ["install.packages('dplyr');", 'install.packages("dplyr")', "correct"],
    ["head(df, 5)", "head(df)", "wrong"],
    ["head(df2)", "head(df)", "wrong"],
    ["head(DF)", "head(df)", "wrong"],
    ["mean(x, na.rm = F)", "mean(x, na.rm = T)", "wrong"],
    ["print('a  b')", "print('a b')", "wrong"],
    ['print("it’s")', 'print("it\'s")', "wrong"],
    ["f(1 L)", "f(1L)", "wrong"],
    ["f(x < - 1)", "f(x <- 1)", "wrong"],
    ["head(df); tail(df)", "head(df)", "wrong"],
    ["head(df).", "head(df)", "wrong"],
  ])("checks %s against %s as %s", (input, answer, verdict) => {
    expect(checkTyped(input, answer)).toBe(verdict);
  });
});

describe("drill completion", () => {
  it("finishing a lesson and review still records XP, streaks and the existing events", () => {
    const summary = { total: 5, correctFirst: 5, applyCorrect: 0, mistakes: 0, accuracy: 1, seconds: 60, maxCombo: 5 };
    const lib = { ...emptyLibrary(), projects: [project], lessons: [lesson] };
    const studied = finishLesson(lib, lesson.id, summary, now);
    const reviewed = finishPractice(studied.lib, summary, 5, addDays(now, 1));
    expect(studied.lib.lessons[0]).toMatchObject({ sessions: 1, level: 1 });
    expect(reviewed.lib.stats).toMatchObject({ xp: studied.xp + reviewed.xp, streak: 2 });
    expect(reviewed.lib.events.map((e) => e.name)).toEqual(["session_done", "review_done"]);
  });
});

describe("definition prompts read mid-sentence", () => {
  const card = (term: string, definition: string): Card => ({
    id: term, lessonId: "l", projectId: "p", kind: "fact", statement: `${term}: ${definition}.`, term, definition, answer: term,
    distractors: ["Big Theta", "Big O", "Collision"],
    srs: { state: "new", ease: 2.5, interval: 0, due: new Date(0).toISOString(), reps: 0, lapses: 0 },
  });
  it("lowercases a leading article and keeps acronyms", () => {
    const ctx = { pool: [], rand: () => 0.5 };
    const prompt = (c: Card) => {
      const ex = genMC(c, ctx);
      return ex.type === "mc" ? ex.prompt : "";
    };
    expect(prompt(card("Big Omega", "A lower bound on how fast a function grows"))).toBe("Which term means: a lower bound on how fast a function grows?");
    expect(prompt(card("Genome", "DNA of an organism taken as a whole"))).toBe("Which term means: DNA of an organism taken as a whole?");
  });
});

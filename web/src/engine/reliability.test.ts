import { describe, expect, it } from "vitest";
import { buildOffline } from "./builder";
import { buildProject, defDraft, lessonTitleFromFile } from "./classbuilder";
import { checkAnswer, genBank } from "./exercises";
import { readTextFile } from "./formats";
import { groupPages } from "./grouping";
import { parseNotes } from "./notes";
import { keyBlanks } from "./session";
import type { Card } from "./types";

const now = new Date(2026, 10, 23, 10);

describe("offline study content", () => {
  it("blanks the concept in algorithms prose", () => {
    const text = [
      "Binary search runs in O(log n) time on a sorted list.",
      "Big O establishes a worst case run time for an algorithm.",
      "This tells you how the running time grows with input size.",
      "Binary search only works when the list is sorted.",
      "The base case stops a recursive algorithm from calling itself.",
      "Quicksort picks a pivot and partitions the remaining elements.",
    ];
    const cards = buildOffline({ title: "Algorithms" }, text.map((line, i) => ({ id: String(i), text: line }))).lessons.flatMap((l) => l.cards);
    const blanks = text.map((statement) => cards.find((c) => c.statement === statement)?.cloze);
    expect(blanks[0]).toBe("O(log n)");
    expect(blanks[1]).toMatch(/^(Big O|worst case|algorithm)$/);
    expect(blanks[2]).toMatch(/^(running time|input size)$/);
    expect(blanks.slice(3)).toEqual(["sorted", "base case", "pivot"]);
  });

  it.each([
    ["Data frame", "A table where every column is a vector", "What is a data frame?"],
    ["Data frame", "Two-dimensional structure with named columns", "What does data frame mean?"],
    ["Array", "A sequence of values you can index", "What is an array?"],
    ["DNA", "The molecule that carries genetic information", "What is DNA?"],
    ["RStudio", "An integrated development environment for R", "What is RStudio?"],
    ["R", "A programming language for statistical computing", "What is R?"],
    ["Big O", "A notation for the asymptotic upper bound", "What is Big O?"],
    ["Python", "A high-level programming language", "What is Python?"],
    ["Vectors", "Sequences of values of one type", "What are vectors?"],
  ])("writes a natural question for %s", (term, definition, question) => {
    expect(defDraft({ term, definition }, "page", []).question).toBe(question);
  });

  it("uses the file title for the project and its sections for lessons", () => {
    const sourceName = "r_basics.md";
    const file = readTextFile(sourceName, `# R Basics: Vectors and Data Frames
A vector holds multiple values of the same type.
A data frame groups columns in a table.
Each column can have a different type.

# The Tidyverse
filter() keeps the rows matching a condition.
select() keeps only the columns you name.
mutate() adds new columns to a data frame.`);
    const pages = file.pages.map((p, i) => ({ ...p, sourceName, id: String(i) }));
    expect(groupPages(pages)).toMatchObject([{ title: "R basics", pageIds: ["0", "1"] }]);
    expect(groupPages(pages.map((p) => ({ ...p, sourceTitle: "Introduction to R" })))[0].title).toBe("Introduction to R");
    expect(buildProject({ title: "R basics", type: "class" }, pages).lessons.map((l) => l.title)).toEqual([
      "R Basics: Vectors and Data Frames", "The Tidyverse",
    ]);
  });

  it("cleans the longer Markdown extension from suggested project titles", () => {
    const sourceName = "r_basics.markdown";
    const file = readTextFile(sourceName, "A vector holds multiple values of the same type.");
    expect(groupPages(file.pages.map((p, i) => ({ ...p, sourceName, id: String(i) })))[0].title).toBe("R basics");
    expect(lessonTitleFromFile(sourceName)).toBe("R basics");
  });

  const fact = (term: string, rest: string, distractors: string[] = []): Card => ({
    id: term, projectId: "p", lessonId: "l", kind: "fact", cloze: term,
    statement: `${term}: ${rest}.`, distractors,
    srs: { state: "new", ease: 2.5, interval: 0, due: now.toISOString(), reps: 0, lapses: 0 },
  });

  it("offers other code tiles and preserves their symbols and casing", () => {
    const c = fact("c()", "combines values into a vector", ["values", "%>%"]);
    const ex = genBank(c, { pool: [c, fact("<-", "assigns a value"), fact("C()", "other function"), fact("vector", "a sequence")], rand: () => 0 });
    expect(ex).toMatchObject({ answers: ["c()"], options: expect.arrayContaining(["c()", "C()", "<-", "%>%"]) });
    if (!ex || ex.type !== "bank") throw new Error("Expected a word bank");
    expect(ex.options).toHaveLength(4);
    expect(checkAnswer(ex, { kind: "slots", value: ["C()"] }).verdict).toBe("wrong");
  });

  it("never copies plain word-bank distractors from the statement", () => {
    const c = fact("Vector", "combines values into a sequence", ["values", "matrix", "%>%"]);
    const ex = genBank(c, { pool: [c, fact("list", "a collection")], rand: () => 0 });
    expect(ex).toMatchObject({ answers: ["vector"], options: expect.arrayContaining(["vector", "matrix", "list"]) });
    if (!ex || ex.type !== "bank") throw new Error("Expected a word bank");
    expect(ex.options).toHaveLength(3);
  });

  it("does not move a legacy fill-in into a function name or onto a repeated verb", () => {
    const card = {
      ...fact("vector", "a sequence"), cloze: "returns",
      statement: "make_vector() returns a sequence of supplied arguments.",
    };
    const another = { ...fact("other", "a collection"), statement: "The vector returns its original values in order." };
    expect(keyBlanks([card, another])(card)).toBeUndefined();
  });

  it("keeps a short syntax definition pasted without punctuation", () => {
    const pages = parseNotes("None marks absence in Python").map((p, i) => ({ ...p, kind: "note" as const, id: String(i) }));
    const result = buildProject({ title: "Python", type: "class" }, pages);
    expect(result.lessons.flatMap((l) => l.cards)).toMatchObject([{ term: "None" }]);
  });
});

import { describe, expect, it } from "vitest";
import { checkTyped } from "./check";
import { buildProject } from "./classbuilder";
import { detectCodeDefinition, isCode, normalizeCode, onlyInCode } from "./code";
import { checkAnswer, genTermType } from "./exercises";
import { readTextFile } from "./formats";
import type { Card } from "./types";

const R_NOTES = `# R Basics

The assignment operator in R is <-, for example x <- 5 stores 5 in x.
c() combines values into a vector, for example c(1, 2, 3).
head(df) returns the first six rows of a data frame.
The $ operator selects one column of a data frame, for example df$age.
The pipe operator %>% passes the result on its left into the function on its right.
mean(x, na.rm = TRUE) computes the mean while ignoring missing values.
install.packages("dplyr") downloads a package from CRAN once.
group_by() followed by summarise() computes one summary row per group.
NA marks a missing value in R.
ggplot(df, aes(x = age, y = income)) + geom_point() draws a scatter plot.
`;

describe("syntax cards (spec 16)", () => {
  it("detects code that leads a sentence", () => {
    expect(detectCodeDefinition("head(df) returns the first six rows of a data frame.")).toEqual({
      term: "head(df)",
      definition: "Returns the first six rows of a data frame",
    });
    expect(detectCodeDefinition("mean(x, na.rm = TRUE) computes the mean while ignoring missing values.")?.term).toBe("mean(x, na.rm = TRUE)");
    expect(detectCodeDefinition("len(xs) returns the number of items in a Python list.")?.term).toBe("len(xs)");
    expect(detectCodeDefinition("ggplot(df, aes(x = age)) + geom_point() draws a scatter plot.")?.term).toBe("ggplot(df, aes(x = age)) + geom_point()");
  });

  it("detects named operators and drops examples that give the answer away", () => {
    expect(detectCodeDefinition("The pipe operator %>% passes the result on its left into the function on its right.")).toEqual({
      term: "%>%",
      definition: "Passes the result on its left into the function on its right",
    });
    expect(detectCodeDefinition("The $ operator selects one column of a data frame, for example df$age.")).toEqual({
      term: "$",
      definition: "Selects one column of a data frame",
    });
    expect(detectCodeDefinition("The assignment operator in R is <-, for example x <- 5 stores 5 in x.")).toEqual({
      term: "<-",
      definition: "The assignment operator in R",
    });
    expect(detectCodeDefinition("c() combines values into a vector, for example c(1, 2, 3).")?.definition).toBe("Combines values into a vector");
  });

  it.each([
    ["NA marks a missing value in R.", "NA"],
    ["NULL is the object that represents absence in R.", "NULL"],
    ["TRUE represents a logical value in R.", "TRUE"],
    ["FALSE represents a boolean value in R.", "FALSE"],
    ["None represents an absent value in Python.", "None"],
    ["NaN represents a missing numeric value.", "NaN"],
    ["Inf represents an infinite numeric value.", "Inf"],
    ["group_by() followed by summarise() computes one summary row per group.", "group_by() followed by summarise()"],
  ])("detects syntax in %s", (line, term) => {
    expect(detectCodeDefinition(line)?.term).toBe(term);
    expect(isCode(term)).toBe(true);
  });

  it("leaves plain sentences alone", () => {
    expect(detectCodeDefinition("Binary search only works when the list is sorted.")).toBeNull();
    expect(detectCodeDefinition("Mitochondria: the organelle that produces most of the cell's ATP")).toBeNull();
    expect(detectCodeDefinition("DNA stores genetic information.")).toBeNull();
    expect(detectCodeDefinition("NA stands for North America in the survey.")).toBeNull();
    expect(detectCodeDefinition("None of the participants could answer.")).toBeNull();
    expect(isCode("Data frame")).toBe(false);
    expect(isCode("%>%")).toBe(true);
  });

  it("never blanks a word that sits inside code", () => {
    expect(onlyInCode('install.packages("dplyr") downloads a package', "packages")).toBe(true);
    expect(onlyInCode("group_by() then one row per group", "group")).toBe(true);
    expect(onlyInCode("keeps only the columns you name.", "name")).toBe(false);
  });

  it("builds syntax cards from R notes, with no code fragments and no garbage terms", () => {
    const file = readTextFile("r-basics.md", R_NOTES);
    const pages = file.pages.map((p, i) => ({ id: `p${i}`, text: p.text, heading: p.heading, sourceName: "r-basics.md", kind: "doc" as const }));
    const res = buildProject({ title: "R", type: "class" }, pages);
    const cards = res.lessons.flatMap((l) => l.cards);
    const terms = cards.filter((c) => c.term).map((c) => c.term);
    expect(terms).toEqual(expect.arrayContaining(["<-", "c()", "head(df)", "$", "%>%", "mean(x, na.rm = TRUE)", 'install.packages("dplyr")', "NA", "group_by() followed by summarise()"]));
    // The old detector split "aes(x = age" on "=" and made a term out of half a call.
    expect(terms.some((t) => /\(.*[^)]$/.test(t!))).toBe(false);
    // "_____by()" style blanks inside names.
    expect(cards.some((c) => /\w____|____\w/.test(c.question ?? ""))).toBe(false);
  });

  it("checks typed code, preserving identifiers and argument case", () => {
    expect(checkTyped("%>%", "%>%")).toBe("correct");
    expect(checkTyped("%<%", "%>%")).toBe("wrong");
    expect(checkTyped("<-", "<-")).toBe("correct");
    expect(checkTyped("mean(x,na.rm=TRUE)", "mean(x, na.rm = TRUE)")).toBe("correct");
    expect(checkTyped("install.packages('dplyr')", 'install.packages("dplyr")')).toBe("correct");
    expect(checkTyped("mean(x, na.rm = true)", "mean(x, na.rm = TRUE)")).toBe("wrong");
    expect(checkTyped("tail(df)", "head(df)")).toBe("wrong");
    expect(checkTyped("na", "NA")).toBe("close");
    expect(checkTyped("No", "NA")).toBe("wrong");
    expect(normalizeCode(" head( df ) ")).toBe("head(df)");
  });

  it("asks 'Which code ...' and grades a typed answer", () => {
    const card: Card = {
      id: "c1",
      lessonId: "l",
      projectId: "p",
      kind: "fact",
      statement: "head(df): returns the first six rows of a data frame.",
      term: "head(df)",
      definition: "Returns the first six rows of a data frame",
      answer: "head(df)",
      question: "What does head(df) do?",
      srs: { state: "new", ease: 2.5, interval: 0, due: new Date().toISOString(), reps: 0, lapses: 0 },
    };
    const ex = genTermType(card)!;
    expect(checkAnswer(ex, { kind: "text", value: "head(df)" }).verdict).toBe("correct");
    expect(checkAnswer(ex, { kind: "text", value: "head" }).verdict).toBe("wrong");
  });
});

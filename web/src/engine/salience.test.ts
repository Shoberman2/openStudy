import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProject, type ClassPage } from "./classbuilder";
import { readTextFile } from "./formats";
import { buildShortlist, rankStudyIdeas, selectStudyBite } from "./salience";

const R_NOTES = `# R Basics

The assignment operator in R is <-, for example x <- 5 stores 5 in x.
c() combines values into a vector, for example c(1, 2, 3).
head(df) returns the first six rows of a data frame.
The $ operator selects one column of a data frame, for example df$age.
The pipe operator %>% passes the result on its left into the function on its right.
mean(x, na.rm = TRUE) computes the mean while ignoring missing values.
NA marks a missing value in R.

# Data frames

A data frame stores a table where each column is a vector. head(df) is the quickest way to check a data frame after reading it.
`;

const pagesOf = (name: string, text: string): ClassPage[] =>
  readTextFile(name, text).pages.map((p, i) => ({ id: `${name}:${i}`, text: p.text, heading: p.heading, sourceName: name, kind: "doc" as const }));

describe("Worth Practicing First (spec 18)", () => {
  const pages = pagesOf("r.md", R_NOTES);
  const drafts = buildProject({ title: "R", type: "class" }, pages).lessons.flatMap((l) => l.cards);
  const ranked = rankStudyIdeas(pages, drafts);

  it("ranks ideas that link back to a sentence on their page", () => {
    expect(ranked.length).toBeGreaterThan(3);
    for (const idea of ranked) {
      const page = pages.find((p) => p.id === idea.pageId)!;
      expect(page.text.replace(/\s+/g, " ").toLowerCase()).toContain(idea.source.toLowerCase().slice(0, 40));
    }
  });

  it("puts typed syntax that repeats across pages near the top", () => {
    const top = selectStudyBite(ranked);
    expect(top.length).toBe(3);
    expect(top[0].title).toBe("head(df)");
    expect(top.filter((i) => i.typed).length).toBeGreaterThanOrEqual(2);
    expect(top.map((i) => i.title)).toContain("head(df)");
  });

  it("is deterministic and never repeats a target", () => {
    const again = rankStudyIdeas(pages, drafts);
    expect(again).toEqual(ranked);
    expect(new Set(ranked.map((i) => i.title)).size).toBe(ranked.length);
  });

  it("takes at most two ideas from one page", () => {
    const one = ranked.map((i) => ({ ...i, pageId: "same" }));
    expect(selectStudyBite(one).length).toBe(2);
  });

  it("picks the group with the strongest ideas and skips groups with nothing to type", () => {
    const prose = pagesOf("story.md", "# Story\n\nThe ship left the harbor at dawn and sailed north for many days.\n");
    const byId = new Map([...pages, ...prose].map((p) => [p.id, p]));
    const list = buildShortlist(
      [
        { key: "story", title: "Story", type: "book", pageIds: prose.map((p) => p.id) },
        { key: "r", title: "R", type: "class", pageIds: pages.map((p) => p.id) },
      ],
      byId,
    );
    expect(list?.groupKey).toBe("r");
    expect(buildShortlist([{ key: "story", title: "Story", type: "book", pageIds: prose.map((p) => p.id) }], byId)).toBeNull();
  });

  it("works on the class fixtures", () => {
    const dir = join(__dirname, "fixtures");
    const fx = readFileSync(join(dir, "r-basics.md"), "utf8");
    const ps = pagesOf("r-basics.md", fx);
    const list = buildShortlist([{ key: "r", title: "R", type: "class", pageIds: ps.map((p) => p.id) }], new Map(ps.map((p) => [p.id, p])));
    expect(list?.ideas.length).toBeGreaterThan(0);
  });
});

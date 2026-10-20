import { describe, expect, it } from "vitest";
import cases from "../../../shared/fixtures/v4-cases.json";
import { importNotes, type NotesExport } from "./applenotes";
import { isVerbatim, localAnswer, retrieve } from "./ask";
import { buildProject } from "./classbuilder";
import { findConnections } from "./connections";
import { dHash, dropDuplicates, hamming } from "./dedupe";
import { readTextFile } from "./formats";
import { groupPages, orderByPageNumber, type GroupPage } from "./grouping";
import { sameAuthor, titlesMatch } from "./identity";
import { defineWord, emptyLibrary, materialize, wordsToDefine } from "./library";
import { pageNumberFromLines } from "./ocr-clean";
import { buildSession } from "./session";
import { detectionSummary } from "./summary";
import type { Library, Page } from "./types";
import { parseWordList } from "./words";
import notesFixture from "../../../shared/fixtures/apple-notes.json";

const NOW = new Date("2026-10-19T12:00:00Z");

describe("parity cases (shared/fixtures/v4-cases.json)", () => {
  it.each(cases.wordLists.map((c, i) => [i, c] as const))("word list %i", (_i, c) => {
    const r = parseWordList(c.text, c.title ?? undefined);
    expect(r.isWordList).toBe(c.isWordList);
    if (c.isWordList) expect(r.words).toEqual(c.words);
  });
  it.each(cases.titlesMatch)("titlesMatch(%s, %s) = %s", (a, b, want) => {
    expect(titlesMatch(a as string, b as string)).toBe(want);
    expect(titlesMatch(b as string, a as string)).toBe(want);
  });
  it.each(cases.sameAuthor)("sameAuthor(%s, %s) = %s", (a, b, want) => {
    expect(sameAuthor(a as string, b as string)).toBe(want);
  });
  it.each(cases.pageNumber.map((c, i) => [i, c] as const))("page number %i", (_i, c) => {
    expect(pageNumberFromLines(c.footer, c.header) ?? null).toBe(c.n);
  });
  it.each(cases.dHash.map((c, i) => [i, c] as const))("dHash %i", (_i, c) => {
    expect(dHash(c.pixels)).toBe(c.hash);
  });
  it.each(cases.hamming as [string, string, number | null][])("hamming(%s, %s) = %s", (a, b, d) => {
    expect(hamming(a, b)).toBe(d === null ? Infinity : d);
  });
  it.each(cases.detectionSummary.map((c) => [c.line, c] as const))("%s", (_l, c) => {
    expect(detectionSummary(c.groups as Parameters<typeof detectionSummary>[0])).toBe(c.line);
  });
  it.each(cases.isVerbatim)("isVerbatim(%s)", (q, src, want) => {
    expect(isVerbatim(q as string, src as string)).toBe(want);
  });
  it("retrieve", () => {
    expect(retrieve(cases.retrieve.question, cases.retrieve.pages).map((r) => r.page.id)).toEqual(cases.retrieve.top);
  });
  it("connections", () => {
    const got = findConnections(cases.connections.lessons).map((c) => ({ projects: c.projects, lessons: c.lessons, terms: c.terms }));
    expect(got).toEqual(cases.connections.expect);
  });
});

const page = (p: Partial<Page> & { id: string; text: string }): Page => ({ projectId: null, kind: "note", createdAt: NOW.toISOString(), ...p });

describe("word lists (10.2)", () => {
  const words = Array.from({ length: 14 }, (_, i) => ({ term: `word${String.fromCharCode(97 + i)}`, definition: `meaning number ${i + 1} of this word` }));

  it("all word pages form one Words group, Vocabulary, other", () => {
    const pages: GroupPage[] = [
      { id: "w1", text: "a", words: words.slice(0, 3), kind: "note", noteId: "n1" },
      { id: "w2", text: "b", words: words.slice(3, 6), kind: "doc", sourceName: "vocab.txt" },
      { id: "x", text: "The Krebs cycle runs inside the mitochondria of every cell.", kind: "note", noteId: "n2", sourceName: "Krebs" },
    ];
    const g = groupPages(pages).find((x) => x.title === "Words")!;
    expect(g).toMatchObject({ key: "w:words", type: "other", category: "Vocabulary", pageIds: ["w1", "w2"] });
  });

  it("builds definition lessons of 12, titled first to last", () => {
    const r = buildProject({ title: "Words", type: "other" }, [{ id: "p1", text: "", words: [...words, { term: "bare" }] }]);
    expect(r.lessons.map((l) => [l.title, l.cards.length])).toEqual([
      ["Worda to Wordl", 12],
      ["Wordm to Wordn", 2],
    ]);
    const c = r.lessons[0].cards[0];
    expect(c).toMatchObject({ term: "worda", definition: "Meaning number 1 of this word", statement: "worda: meaning number 1 of this word.", question: "What is worda?", answer: "worda" });
    expect(c.distractors).toHaveLength(3);
  });

  it("an Apple note that is a word list becomes one page", () => {
    const r = importNotes([{ id: "v1", title: "Vocab", text: "Vocab\nephemeral - lasting a very short time\nlaconic: using very few words\nsonder\nserendipity - a happy accident" }], new Set(), NOW);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0].words?.map((w) => w.term)).toEqual(["ephemeral", "laconic", "sonder", "serendipity"]);
  });

  it("a words.txt file becomes one word-list page", () => {
    const r = readTextFile("words.txt", "sonder\nlimerence\npetrichor");
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0].words).toHaveLength(3);
  });

  it("v3 Apple Notes fixture has no word lists", () => {
    const r = importNotes((notesFixture as NotesExport).notes, new Set(), NOW);
    expect(r.pages.some((p) => p.words)).toBe(false);
  });

  it("words to define, then a saved definition becomes a card", () => {
    const p = page({ id: "wp", text: "x", projectId: "P", words: [{ term: "ephemeral", definition: "lasting a very short time" }, { term: "sonder" }] });
    const built = materialize("P", buildProject({ title: "Words", type: "other" }, [{ id: "wp", text: "x", words: p.words }]), [], { now: NOW });
    let lib: Library = { ...emptyLibrary(), pages: [p], lessons: built.lessons, cards: built.cards };
    expect(wordsToDefine(lib, "P")).toEqual([{ term: "sonder", pageId: "wp" }]);
    lib = defineWord(lib, "P", "wp", "sonder", "the feeling that every stranger has a whole life", NOW);
    expect(wordsToDefine(lib, "P")).toEqual([]);
    expect(lib.lessons).toHaveLength(1);
    expect(lib.lessons[0].title).toBe("Ephemeral to Sonder");
    expect(lib.cards.map((c) => c.term)).toEqual(["ephemeral", "sonder"]);
    expect(lib.pages[0].words![1].definition).toBe("the feeling that every stranger has a whole life");
  });

  it("definition-heavy lessons practice with definition exercises even in a book project", () => {
    const built = materialize("P", buildProject({ title: "Words", type: "other" }, [{ id: "p1", text: "", words: words.slice(0, 6) }]), [], { now: NOW });
    const ex = buildSession(built.lessons[0], built.cards, emptyLibrary().profile, NOW, () => 0.1, built.cards, { projectType: "book" });
    expect(ex.some((e) => e.type === "def-mc")).toBe(true);
  });
});

describe("same book, different spelling (10.4)", () => {
  it("Sapiens and Sapiens: A Brief History merge; BIO 101 and BIO 102 stay apart", () => {
    const pages: GroupPage[] = [
      { id: "a", text: "Humans spread across the world.", suggestedTitle: "Sapiens", kind: "note" },
      { id: "b", text: "The cognitive revolution changed everything.", suggestedTitle: "Sapiens: A Brief History of Humankind", suggestedAuthor: "Yuval Noah Harari", kind: "note" },
      { id: "c", text: "Farming made us work harder.", suggestedTitle: "Sapiens", kind: "note" },
      { id: "d", text: "Cells are the unit of life.", suggestedTitle: "BIO 101", kind: "note" },
      { id: "e", text: "Genes code for proteins.", suggestedTitle: "BIO 102", kind: "note" },
    ];
    const gs = groupPages(pages);
    const sap = gs.find((g) => g.pageIds.includes("a"))!;
    expect(sap.title).toBe("Sapiens");
    expect(sap.author).toBe("Yuval Noah Harari");
    expect(sap.pageIds.sort()).toEqual(["a", "b", "c"]);
    expect(gs.find((g) => g.pageIds.includes("d"))!.pageIds).toEqual(["d"]);
  });

  it("conflicting authors block a merge", () => {
    const pages: GroupPage[] = [
      { id: "a", text: "x", suggestedTitle: "Meditations", suggestedAuthor: "Marcus Aurelius", kind: "note" },
      { id: "b", text: "y", suggestedTitle: "Meditations: A New Translation", suggestedAuthor: "René Descartes", kind: "note" },
    ];
    expect(groupPages(pages)).toHaveLength(2);
  });
});

describe("duplicates (10.3)", () => {
  const long = "The obstacle in the path becomes the path, said the emperor to himself.";
  it("same text, or near-identical image plus similar text", () => {
    const existing = [{ text: long }, { text: "A page about cells and the membrane around them all", imageHash: "aa00000000000000" }];
    const r = dropDuplicates(existing, [
      { text: long.toUpperCase() },
      { text: "A page about cells and the membrane around them", imageHash: "aa00000000000001" },
      { text: "A completely different page about stoic virtue and duty", imageHash: "aa00000000000001" },
      { text: "short", imageHash: "ff" },
      { text: "Fresh words that nobody has seen before on any page", imageHash: undefined },
      { text: "Fresh words that nobody has seen before on any page" },
    ]);
    expect(r.duplicates).toBe(3);
    expect(r.fresh.map((p) => p.text)).toEqual(["A completely different page about stoic virtue and duty", "short", "Fresh words that nobody has seen before on any page"]);
  });
});

describe("page order (10.5)", () => {
  it("orders screenshots by page number when most have one, numberless last", () => {
    const ps = [
      { id: "a", kind: "screenshot", pageNumber: 30, createdAt: "1" },
      { id: "b", kind: "screenshot", createdAt: "2" },
      { id: "c", kind: "screenshot", pageNumber: 12, createdAt: "3" },
    ];
    expect(orderByPageNumber(ps).map((p) => p.id)).toEqual(["c", "a", "b"]);
    expect(orderByPageNumber([ps[0], ps[1], { id: "d", kind: "screenshot", createdAt: "4" }]).map((p) => p.id)).toEqual(["a", "b", "d"]);
  });

  it("Sort groups list pages in page order", () => {
    const pages: GroupPage[] = [
      { id: "p2", text: "Second page body text here.", kind: "screenshot", header: "Deep Work", pageNumber: 41 },
      { id: "p1", text: "First page body text here.", kind: "screenshot", header: "Deep Work", pageNumber: 40 },
    ];
    expect(groupPages(pages)[0].pageIds).toEqual(["p1", "p2"]);
  });
});

describe("ask (10.7)", () => {
  it("offline answer quotes the closest sentences", () => {
    const pages = [
      { id: "a", text: "The Krebs cycle runs in the mitochondria and makes ATP. It needs oxygen to keep going. Bread is tasty." },
      { id: "b", text: "Stoics say virtue is the only good and the rest does not matter." },
    ];
    const r = localAnswer("Where does the Krebs cycle happen?", pages);
    expect(r[0]).toEqual({ pageId: "a", text: "The Krebs cycle runs in the mitochondria and makes ATP." });
    expect(localAnswer("What about quantum gravity?", pages)).toEqual([]);
  });
});

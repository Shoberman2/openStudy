import { describe, expect, it } from "vitest";
import fixture from "../../../shared/fixtures/apple-notes.json";
import sample from "../data/sample-library.json";
import { BRIDGE_MARKER, fnv1a, importNotes, noteHtmlToText, notePages, notesSummary, parseBridgeText, type NotesExport } from "./applenotes";
import { categorize, lexiconCategory, sharedFolder } from "./categories";
import { cleanNoteTitle, findCourseCode, groupPages } from "./grouping";
import { normalizeLibrary, type RawLibrary } from "./library";

const notes = (fixture as NotesExport).notes;
const NOW = new Date("2026-10-19T12:00:00Z");

describe("Apple Notes to pages (9.3)", () => {
  it("imports every note except deleted and near-empty ones", () => {
    const r = importNotes(notes, new Set(), NOW);
    expect(r.notes).toBe(11);
    expect(r.empty).toBe(1);
    expect(r.pages.length).toBe(15);
    expect(r.pages.every((p) => p.kind === "note" && p.projectId === null && p.noteId)).toBe(true);
    expect(r.pages.some((p) => p.folder === "Recently Deleted")).toBe(false);
    expect(notesSummary(r)).toBe("Added 15 pages from 11 notes.");
  });

  it("skips notes already in the library", () => {
    const r = importNotes(notes, new Set(["x-coredata://n1", "x-coredata://n2"]), NOW);
    expect(r.already).toBe(2);
    expect(r.notes).toBe(9);
    expect(notesSummary(r)).toBe("Added 12 pages from 9 notes. 2 were already here.");
  });

  it("says nothing new when every note was already here", () => {
    const all = new Set(notes.map((n) => n.id));
    expect(notesSummary(importNotes(notes.slice(0, 2), all, NOW))).toBe("Nothing new. All 2 notes were already here.");
    expect(notesSummary(importNotes(notes.slice(0, 1), all, NOW))).toBe("Nothing new. That note was already here.");
  });

  it("splits at headings, drops the title line and keeps folder and dates", () => {
    const ps = notePages(notes[0], NOW);
    expect(ps.map((p) => p.heading)).toEqual(["Atomic Habits by James Clear", "Identity"]);
    expect(ps[0].text.startsWith("Habits are the compound interest")).toBe(true);
    expect(ps[0].text).toContain("\n\nYou do not rise");
    expect(ps.map((p) => p.sourceIndex)).toEqual([1, 2]);
    expect(ps[0].folder).toBe("Books");
    expect(ps[0].createdAt).toBe("2026-09-01T10:00:00.000Z");
  });

  it("reads Books excerpts inside a note as verbatim book pages", () => {
    const ps = notePages(notes[11], NOW);
    expect(ps.length).toBe(2);
    expect(ps.every((p) => p.verbatim && p.suggestedTitle === "Meditations" && p.suggestedAuthor === "Marcus Aurelius")).toBe(true);
  });

  it("turns note html into text with markdown headings", () => {
    expect(noteHtmlToText("<div>Title</div><h2>Part</h2><div>One<br>two</div>")).toBe("Title\n\n## Part\n\nOne\ntwo");
  });
});

describe("Shortcut bridge text (9.2)", () => {
  const text = [
    BRIDGE_MARKER,
    "Title: Krebs cycle",
    "Folder: School",
    "Krebs cycle",
    "The Krebs cycle runs inside the mitochondria of the cell and makes ATP.",
    BRIDGE_MARKER,
    "Title: Stoicism",
    "Folder: ",
    "Virtue is the only good, said the Stoics, and reason is our guide.",
  ].join("\n");

  it("splits notes and reads title and folder", () => {
    const ns = parseBridgeText(text);
    expect(ns.map((n) => [n.title, n.folder])).toEqual([
      ["Krebs cycle", "School"],
      ["Stoicism", undefined],
    ]);
    expect(notePages(ns[0], NOW)[0].text).toBe("The Krebs cycle runs inside the mitochondria of the cell and makes ATP.");
  });

  it("gives stable ids (parity with iOS)", () => {
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
    expect(parseBridgeText(text)[1].id).toBe("sc:" + fnv1a("Stoicism\nVirtue is the only good, said the Stoics, and reason is our guide."));
    expect(parseBridgeText(text)[1].id).toBe("sc:b9acf5b9");
  });
});

describe("note titles (9.5.1)", () => {
  it.each([
    ["Atomic Habits by James Clear", "Atomic Habits", "James Clear"],
    ["Notes on Thinking, Fast and Slow", "Thinking, Fast and Slow", undefined],
    ["Atomic Habits ch 3", "Atomic Habits", undefined],
    ["Seneca on time 3/14", "Seneca on time", undefined],
    ["Sapiens summary", "Sapiens", undefined],
    ["Stand by me", "Stand by me", undefined],
  ])("%s", (raw, title, author) => {
    expect(cleanNoteTitle(raw)).toEqual(author ? { title, author } : { title });
  });
});

describe("categories (9.4)", () => {
  it("course prefix, folder, lexicon, fallback", () => {
    expect(categorize({ title: "CHEM 210: Organic", pages: [] })).toBe("Chemistry");
    expect(categorize({ title: "Ideas", pages: [{ text: "x", folder: "Work" }, { text: "y", folder: "Work" }, { text: "z" }] })).toBe("Work");
    expect(categorize({ title: "Ideas", type: "other", pages: [{ text: "x", folder: "Notes" }] })).toBe("General");
    expect(categorize({ title: "Something", type: "book", pages: [{ text: "plain words about nothing" }] })).toBe("Reading");
    expect(categorize({ title: "Something", type: "class", pages: [] })).toBe("Classes");
  });

  it("generic folders never name a category", () => {
    expect(sharedFolder([{ folder: "Notes" }, { folder: "notes" }])).toBeUndefined();
    expect(sharedFolder([{ folder: "School" }, { folder: "School" }, { folder: "Home" }])).toBe("School");
    expect(sharedFolder([{ folder: "School" }, { folder: "Home" }])).toBeUndefined();
  });

  it("needs 3 distinct subject words", () => {
    expect(lexiconCategory("cell cell cell cell cell")).toBeUndefined();
    expect(lexiconCategory("The cell membrane and the cell nucleus hold the cell's genes.")).toBe("Biology");
  });

  it("backfills missing categories from pages and keeps existing ones", () => {
    const raw = structuredClone(sample) as RawLibrary;
    raw.projects = raw.projects!.map((p) => (p.id === "smpaurelis" ? p : { ...p, category: undefined }));
    const lib = normalizeLibrary(raw, NOW);
    expect(Object.fromEntries(lib.projects.map((p) => [p.id, p.category]))).toEqual({
      smpcarnegi: "Self-improvement",
      smpaurelis: "Philosophy",
      smpbio101: "Biology",
    });
  });
});

describe("grouping notes into projects (9.5)", () => {
  it("finds books, classes, topics and folders (parity fixture)", () => {
    const { pages } = importNotes(notes, new Set(), NOW);
    const groups = groupPages(pages).map((g) => ({ title: g.title, author: g.author, type: g.type, category: g.category, pages: g.pageIds.length }));
    expect(groups).toEqual([
      { title: "BIO 101", author: undefined, type: "class", category: "Biology", pages: 5 },
      { title: "Atomic Habits", author: "James Clear", type: "book", category: "Books", pages: 3 },
      { title: "Meditations", author: "Marcus Aurelius", type: "book", category: "Reading", pages: 2 },
      { title: "Philosophy notes", author: undefined, type: "other", category: "Philosophy", pages: 2 },
      { title: "Work", author: undefined, type: "other", category: "Work", pages: 2 },
      { title: "Loose notes", author: undefined, type: "other", category: "General", pages: 1 },
    ]);
  });

  it("a lone note joins the class it belongs to", () => {
    const { pages } = importNotes(notes, new Set(), NOW);
    const bio = groupPages(pages).find((g) => g.title === "BIO 101")!;
    const krebs = pages.find((p) => p.noteId === "x-coredata://n5")!;
    expect(bio.pageIds).toContain(krebs.id);
  });
});

describe("course names (9.5.2)", () => {
  it.each([
    ["BIO101 Cell Biology, week 2", "Cell Biology"],
    ["CS 229: Machine Learning. Lecture 3", "Machine Learning"],
    ["BIO 101 Lecture 5 notes", undefined],
  ])("%s", (text, following) => {
    expect(findCourseCode(text)?.following).toBe(following);
  });
});

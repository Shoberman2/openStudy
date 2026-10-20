import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import sample from "../data/sample-library.json";
import { buildClass, buildProject, detectDefinition, lessonTitleFromFile } from "./classbuilder";
import { cleanFileTitle, parsePptxSlides, readDocx, readPptx, readTextFile, sectionize } from "./formats";
import { findCourseCode, groupPages, guessType } from "./grouping";
import { addSample, emptyLibrary, materialize, normalizeLibrary } from "./library";
import { buildPlan, COST } from "./plan";
import { buildPracticeTest, buildSession, scoreTest } from "./session";
import type { Library } from "./types";
import { addDays, dayDiff, localDay, seeded } from "./util";

// ---------- helpers to build Office files in memory ----------

const sp = (paras: string[], ph?: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="1" name="x"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ""}</p:nvPr></p:nvSpPr><p:txBody>${paras
    .map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`)
    .join("")}</p:txBody></p:sp>`;
const slideXml = (title: string, body: string[]) => `<?xml version="1.0"?><p:sld><p:cSld><p:spTree>${sp([title], "title")}${sp(body)}${sp(["7"], "sldNum")}</p:spTree></p:cSld></p:sld>`;

async function makePptx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("docProps/core.xml", `<cp:coreProperties><dc:title>Lecture 4: Enzymes</dc:title></cp:coreProperties>`);
  zip.file("ppt/slides/slide1.xml", slideXml("What Enzymes Do", ["Enzyme: a protein that speeds up a chemical reaction", "Enzymes are not used up &amp; can be reused"]));
  zip.file("ppt/slides/slide2.xml", slideXml("Active Site", ["Active site: the region where the substrate binds to the enzyme"]));
  zip.file("ppt/slides/slide10.xml", slideXml("Summary", ["Temperature and pH change enzyme activity"]));
  zip.file("ppt/slides/slide3.xml", slideXml("Thanks", [""]));
  zip.file("ppt/slides/_rels/slide2.xml.rels", `<Relationships><Relationship Id="rId2" Target="../notesSlides/notesSlide5.xml"/></Relationships>`);
  zip.file("ppt/notesSlides/notesSlide5.xml", `<p:notes><p:cSld><p:spTree>${sp([""], "sldImg")}${sp(["Mention the lock and key model here."], "body")}${sp(["2"], "sldNum")}</p:spTree></p:cSld></p:notes>`);
  return zip.generateAsync({ type: "uint8array" });
}

const wp = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

async function makeDocx(paras: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document><w:body>${paras}</w:body></w:document>`);
  zip.file("docProps/core.xml", `<cp:coreProperties><dc:title>Study Guide</dc:title></cp:coreProperties>`);
  return zip.generateAsync({ type: "uint8array" });
}

// ---------- formats ----------

describe("pptx", () => {
  it("reads slides in numeric order with titles, bullets and speaker notes", async () => {
    const data = await makePptx();
    const { title, slides } = await parsePptxSlides(data);
    expect(title).toBe("Lecture 4: Enzymes");
    expect(slides.map((s) => s.heading)).toEqual(["What Enzymes Do", "Active Site", "Thanks", "Summary"]);
    expect(slides[0].body).toEqual(["Enzyme: a protein that speeds up a chemical reaction", "Enzymes are not used up & can be reused"]);
    expect(slides[1].notes).toEqual(["Mention the lock and key model here."]);
    expect(slides.every((s) => !s.body.includes("7"))).toBe(true);
    const r = await readPptx(data);
    expect(r.pages.map((p) => p.sourceIndex)).toEqual([1, 2, 4]); // the empty "Thanks" slide is skipped
    expect(r.pages[1].text).toContain("lock and key");
    expect(r.pages.every((p) => p.kind === "slides")).toBe(true);
  });
});

describe("docx", () => {
  it("splits sections at Title/Heading styles", async () => {
    const data = await makeDocx(
      wp("Cell Biology Notes", "Title") +
        wp("Membranes", "Heading1") +
        wp("Osmosis: diffusion of water across a selectively permeable membrane.") +
        wp("Transport", "Heading2") +
        wp("Active transport requires ATP."),
    );
    const r = await readDocx(data);
    expect(r.sourceTitle).toBe("Study Guide");
    expect(r.pages.map((p) => p.heading)).toEqual(["Membranes", "Transport"]);
    expect(r.pages[0].text).toContain("Osmosis");
    expect(r.pages.every((p) => p.kind === "doc")).toBe(true);
  });
  it("chunks by ~250 words without headings", () => {
    const para = { text: Array(100).fill("word").join(" "), heading: false };
    expect(sectionize([para, para, para, para, para]).length).toBe(2);
  });
  it("reads markdown and html headings, and Books excerpts in text files", () => {
    const md = readTextFile("notes.md", "# Photosynthesis\nPlants turn light into chemical energy.\n\n## Chlorophyll\nChlorophyll: the green pigment that absorbs light.");
    expect(md.pages.map((p) => p.heading)).toEqual(["Photosynthesis", "Chlorophyll"]);
    const html = readTextFile("page.html", "<h2>Cells</h2><p>The cell is the basic unit of life.</p>");
    expect(html.pages[0].heading).toBe("Cells");
    const books = readTextFile("x.txt", "“Quote here and more.”\n\nExcerpt From\nMeditations\nMarcus Aurelius\nThis material may be protected by copyright.");
    expect(books.pages[0]).toMatchObject({ kind: "note", suggestedTitle: "Meditations", verbatim: true });
  });
  it("cleans file names into titles", () => {
    expect(cleanFileTitle("Lecture_04 - Enzymes.pptx")).toBe("Enzymes");
    expect(cleanFileTitle("week3_notes_photosynthesis.pdf")).toBe("Photosynthesis");
    expect(cleanFileTitle("Organic Chemistry.docx")).toBe("Organic Chemistry");
  });
});

// ---------- definitions ----------

describe("definition detection", () => {
  it("finds the supported shapes", () => {
    expect(detectDefinition("Mitochondria: the organelle that produces most of the cell's ATP.")).toEqual({ term: "Mitochondria", definition: "the organelle that produces most of the cell's ATP" });
    expect(detectDefinition("Osmosis - diffusion of water across a membrane")?.term).toBe("Osmosis");
    expect(detectDefinition("Kinetic energy = the energy an object has because of motion")?.term).toBe("Kinetic energy");
    expect(detectDefinition("Diffusion is the movement of molecules from high to low concentration.")).toEqual({ term: "Diffusion", definition: "the movement of molecules from high to low concentration" });
    expect(detectDefinition("Deoxyribonucleic acid (DNA) is the molecule that carries genetic information")?.term).toBe("Deoxyribonucleic acid");
    expect(detectDefinition("Photosynthesis refers to the process plants use to make sugar")?.term).toBe("Photosynthesis");
  });
  it("rejects lookalikes", () => {
    expect(detectDefinition("Life is long enough, and a sufficiently generous amount has been given.")).toBeNull();
    expect(detectDefinition("So it is: we are not given a short life but we make it short")).toBeNull();
    expect(detectDefinition("Note: see page 4")).toBeNull();
    expect(detectDefinition("This is the most important idea in the whole course today")).toBeNull();
    expect(detectDefinition("A very long term with far too many words in it: a definition of enough words")).toBeNull();
  });
});

// ---------- grouping ----------

describe("grouping v2", () => {
  it("groups files that share a course code", () => {
    const g = groupPages([
      { id: "a1", kind: "pdf", sourceName: "Lecture 1.pdf", sourceIndex: 1, heading: "BIO 101 Cell Biology", text: "Welcome to BIO 101 Cell Biology. Cells are the unit of life." },
      { id: "a2", kind: "pdf", sourceName: "Lecture 1.pdf", sourceIndex: 2, text: "Prokaryotes have no nucleus." },
      { id: "b1", kind: "slides", sourceName: "membranes.pptx", sourceIndex: 1, heading: "Membranes", text: "BIO101 week 2\nThe membrane is a bilayer." },
      { id: "c1", kind: "doc", sourceName: "Shopping.docx", sourceIndex: 1, text: "Eggs, milk, bread and coffee for the week ahead." },
    ]);
    const bio = g.find((x) => x.pageIds.includes("a1"))!;
    expect(bio.pageIds.sort()).toEqual(["a1", "a2", "b1"]);
    expect(bio.title).toBe("BIO 101: Cell Biology");
    expect(bio.type).toBe("class");
    expect(g.find((x) => x.pageIds.includes("c1"))!.pageIds).toEqual(["c1"]);
    expect(findCourseCode("see ISBN 978 and CS229 Machine Learning")?.code).toBe("CS 229");
  });
  it("treats files as units and merges overlapping titles", () => {
    const g = groupPages([
      { id: "e1", kind: "pdf", sourceName: "Lecture 3 - Enzyme Kinetics.pdf", sourceIndex: 1, text: "Rates of reactions." },
      { id: "e2", kind: "pdf", sourceName: "Lecture 3 - Enzyme Kinetics.pdf", sourceIndex: 2, text: "Michaelis constant." },
      { id: "f1", kind: "doc", sourceName: "enzyme_kinetics_review.docx", sourceIndex: 1, text: "Practice problems." },
      { id: "m1", kind: "pdf", sourceName: "Membranes.pdf", sourceIndex: 1, text: "Lipids." },
    ]);
    const enz = g.find((x) => x.pageIds.includes("e1"))!;
    expect(enz.pageIds.sort()).toEqual(["e1", "e2", "f1"]);
    expect(enz.title).toBe("Enzyme Kinetics");
    expect(g.find((x) => x.pageIds.includes("m1"))!.title).toBe("Membranes");
  });
  it("puts photos taken within 3 hours in one pile", () => {
    const g = groupPages([
      { id: "p1", kind: "photo", text: "glycolysis splits glucose", createdAt: "2026-10-09T10:00:00Z" },
      { id: "p2", kind: "photo", text: "krebs cycle makes carriers", createdAt: "2026-10-09T12:30:00Z" },
      { id: "p3", kind: "photo", text: "supply and demand curves", createdAt: "2026-10-10T18:00:00Z" },
    ]);
    expect(g.find((x) => x.pageIds.includes("p1"))!.pageIds).toEqual(["p1", "p2"]);
    expect(g.find((x) => x.pageIds.includes("p3"))!.pageIds).toEqual(["p3"]);
  });
  it("guesses project type", () => {
    expect(guessType([{ id: "x", kind: "screenshot", text: "a" }])).toBe("book");
    expect(guessType([{ id: "x", kind: "slides", text: "a" }])).toBe("class");
    expect(guessType([{ id: "x", kind: "doc", sourceName: "recipe.docx", text: "a" }])).toBe("other");
  });
});

// ---------- class lessons ----------

describe("class lessons", () => {
  const pages = [
    { id: "l2a", kind: "slides" as const, sourceName: "Lecture 2 - Membranes.pptx", sourceIndex: 1, heading: "Membranes", text: "Cell membrane: a phospholipid bilayer that controls what enters the cell\nOsmosis: diffusion of water across a selectively permeable membrane\nProteins in the membrane move ions across it" },
    { id: "l1a", kind: "slides" as const, sourceName: "Lecture 1 - The Cell.pptx", sourceIndex: 1, heading: "Organelles", text: "Mitochondria: the organelle that produces most of the cell's ATP\nRibosome: the structure that builds proteins from amino acids\nAll living things are made of one or more cells" },
  ];
  it("makes one lesson per file in file-number order with definition cards first", () => {
    const r = buildClass({ title: "BIO 101", type: "class" }, pages);
    expect(r.lessons.map((l) => l.title)).toEqual(["The Cell", "Membranes"]);
    const c = r.lessons[0].cards[0];
    expect(c).toMatchObject({ term: "Mitochondria", definition: "The organelle that produces most of the cell's ATP", answer: "Mitochondria", question: "What is mitochondria?" });
    expect(c.statement).toBe("Mitochondria: the organelle that produces most of the cell's ATP.");
    expect(c.distractors).toHaveLength(3);
    expect(r.lessons.every((l) => l.cards.length <= 24)).toBe(true);
    expect(r.lessons[0].cards.some((x) => !x.term)).toBe(true); // cloze facts fill in after definitions
    expect(r.quotes).toEqual([]);
  });
  it("keeps term and definition when cards are materialized", () => {
    const r = buildClass({ title: "BIO 101", type: "class" }, pages);
    const m = materialize("p", r, []);
    const def = m.cards.find((c) => c.term === "Mitochondria")!;
    expect(def.definition).toBe("The organelle that produces most of the cell's ATP");
    expect(lessonTitleFromFile("BIO101 Lecture 3: Cellular Respiration")).toBe("Cellular Respiration");
  });
  it("routes books to the classic builder", () => {
    const r = buildProject({ title: "B", type: "book" }, [{ id: "s", kind: "screenshot", text: "Criticism is futile because it puts a person on the defensive and makes him justify himself." }]);
    expect(r.lessons[0].cards[0].term).toBeUndefined();
  });
});

// ---------- sessions, tests, plan ----------

function sampleLib(now: Date): Library {
  const lib = addSample(emptyLibrary(), sample as never, now);
  return { ...lib, profile: { ...lib.profile, onboarded: true, dailyGoalXP: 20 } };
}

describe("class sessions and practice tests", () => {
  const now = new Date(2026, 9, 16, 9);
  const lib = sampleLib(now);
  it("loads the sample class with a goal 10 days out and legacy profiles", () => {
    expect(lib.projects.find((p) => p.id === "smpbio101")!.goalDate).toBe(localDay(addDays(now, 10)));
    expect(normalizeLibrary({ profile: { bringing: "both" } } as never).profile.bringing).toEqual(["books"]);
    expect(normalizeLibrary({ projects: [{ id: "x", title: "t", color: "blue", createdAt: "", focus: "ideas", quotesAsked: false }] } as never).projects[0].type).toBe("book");
  });
  it("uses definition exercises for class lessons", () => {
    const lesson = lib.lessons.find((l) => l.id === "lb1")!;
    const ex0 = buildSession(lesson, lib.cards, lib.profile, now, seeded(2), lib.cards, { projectType: "class" });
    expect(ex0.some((e) => e.type === "def-mc" || e.type === "match")).toBe(true);
    const ex3 = buildSession({ ...lesson, level: 3 }, lib.cards, { ...lib.profile, goals: ["ideas"] }, now, seeded(4), lib.cards, { projectType: "class" });
    expect(ex3.some((e) => e.type === "term-type")).toBe(true);
    expect(ex3.filter((e) => e.type === "explain").length).toBeLessThanOrEqual(1);
    expect(ex3[0].type).not.toBe("explain");
  });
  it("builds and scores a practice test, flagging weak lessons", () => {
    const lessons = lib.lessons.filter((l) => l.projectId === "smpbio101");
    const cards = lib.cards.filter((c) => c.projectId === "smpbio101");
    const test = buildPracticeTest(lessons, cards, seeded(5));
    expect(test.length).toBe(Math.min(20, cards.length));
    expect(new Set(test.flatMap((e) => e.cardIds)).size).toBe(test.length);
    const lessonOf = new Map(cards.map((c) => [c.id, c.lessonId]));
    const answers = test.map((ex) => ({ ex, verdict: lessonOf.get(ex.cardIds[0]) === "lb1" ? ("correct" as const) : ("wrong" as const) }));
    const r = scoreTest(answers, cards);
    expect(r.perLesson.find((l) => l.lessonId === "lb1")!.accuracy).toBe(1);
    expect(r.weakLessons).toEqual(["lb2"]);
    expect(r.missedCardIds.length).toBe(answers.filter((a) => a.verdict === "wrong").length);
    expect(r.accuracy).toBeCloseTo(r.correct / r.total);
  });
});

describe("study plan", () => {
  const now = new Date(2026, 9, 16, 9);

  function classLib(lessonCount: number, goalInDays: number): Library {
    const lib = sampleLib(now);
    const lessons = Array.from({ length: lessonCount }, (_, i) => ({ id: `L${i}`, projectId: "cls", title: `Lesson ${i}`, summary: "", kind: "theme" as const, order: i, level: 0, sessions: 0 }));
    return {
      ...lib,
      projects: [{ id: "cls", title: "CHEM 110", color: "green", createdAt: now.toISOString(), focus: "ideas", quotesAsked: true, type: "class", goalDate: localDay(addDays(now, goalInDays)) }],
      lessons,
      cards: lib.cards.slice(0, 0),
      events: [],
    };
  }

  it("spaces lessons, caps reviews at 40% and schedules practice tests", () => {
    const lib = sampleLib(now);
    // Make 60 cards due today to exercise the review cap.
    const many = Array.from({ length: 60 }, (_, i) => ({ ...lib.cards[i % lib.cards.length], id: `due${i}`, srs: { state: "review" as const, ease: 2.5, interval: 3, due: new Date(2026, 9, 15).toISOString(), reps: 2, lapses: 0 } }));
    const plan = buildPlan({ ...lib, cards: [...lib.cards, ...many] }, now);
    const goal = lib.projects.find((p) => p.id === "smpbio101")!.goalDate!;
    expect(plan.days.length).toBe(11);
    expect(plan.days[0].date).toBe(localDay(now));
    expect(plan.days[plan.days.length - 1].goals).toContain("smpbio101");
    for (const d of plan.days) {
      const reviewMin = d.items.filter((x) => x.kind === "review").reduce((s, x) => s + (x.kind === "review" ? x.cards * COST.reviewCard : 0), 0);
      expect(reviewMin).toBeLessThanOrEqual(d.budget * 0.4 + 1e-9);
      const ids = d.items.flatMap((x) => (x.kind === "lesson" ? [x.lessonId] : []));
      expect(new Set(ids).size).toBe(ids.length); // never twice in one day
    }
    expect(plan.days[0].items.find((x) => x.kind === "review")!).toMatchObject({ cards: Math.floor((plan.days[0].budget * 0.4) / COST.reviewCard) });
    // No lesson on consecutive days unless the goal is <= 2 days away.
    const seen = new Map<string, string>();
    for (const d of plan.days)
      for (const x of d.items) {
        if (x.kind !== "lesson") continue;
        const prev = seen.get(x.lessonId);
        if (prev && dayDiff(prev, d.date) === 1) expect(dayDiff(d.date, goal)).toBeLessThanOrEqual(2);
        seen.set(x.lessonId, d.date);
      }
    const testDays = plan.days.filter((d) => d.items.some((x) => x.kind === "test" && x.projectId === "smpbio101")).map((d) => dayDiff(d.date, goal));
    expect(testDays.sort()).toEqual([1, 3, 7]);
  });

  it("allows consecutive days when the goal is 2 days away", () => {
    const plan = buildPlan(classLib(1, 2), now);
    const days = plan.days.filter((d) => d.items.some((x) => x.kind === "lesson")).map((d) => d.date);
    expect(days.length).toBeGreaterThanOrEqual(2);
    expect(dayDiff(days[0], days[1])).toBe(1);
  });

  it("reports the minutes a day needed when the goal is not reachable", () => {
    const lib = classLib(12, 5);
    const plan = buildPlan(lib, now);
    const f = plan.feasibility.find((x) => x.projectId === "cls")!;
    // 12 lessons x 3 sessions x 4 min over 5 days, with room for reviews: 144 / 5 / 0.6 = 48 -> 50.
    expect(f.neededMinutes).toBe(50);
    expect(f.neededMinutes % 5).toBe(0);
    const relaxed = buildPlan({ ...lib, projects: lib.projects.map((p) => ({ ...p, goalDate: localDay(addDays(now, 40)) })) }, now);
    expect(relaxed.feasibility).toEqual([]);
  });

  it("uses completions from today's events and gives weak lessons priority", () => {
    const lib = sampleLib(now);
    const withEvents: Library = {
      ...lib,
      profile: { ...lib.profile, dailyGoalXP: 50 },
      lessons: lib.lessons.map((l) => (l.id === "lb1" ? { ...l, level: 1, sessions: 1 } : l)),
      events: [
        { t: now.toISOString(), name: "session_done", props: { lessonId: "lb1", accuracy: 1, seconds: 60, xp: 15 } },
        { t: now.toISOString(), name: "test_done", props: { projectId: "smpbio101", accuracy: 0.5, weakLessons: "lb2" } },
      ],
    };
    const plan = buildPlan(withEvents, now);
    const today = plan.days[0];
    expect(today.items[0]).toMatchObject({ kind: "lesson", lessonId: "lb1", done: true });
    expect(today.items.filter((x) => x.kind === "lesson" && x.lessonId === "lb1")).toHaveLength(1);
    const firstBio = today.items.find((x) => x.kind === "lesson" && x.projectId === "smpbio101" && !x.done);
    expect(firstBio).toMatchObject({ lessonId: "lb2", weak: true });
  });
});

import { describe, expect, it } from "vitest";
import sample from "../data/sample-library.json";
import type { BuildResult, FactDraft } from "./builder";
import { buildProject } from "./classbuilder";
import { materialize, normalizeLibrary, type RawLibrary } from "./library";
import { PICTURES_LESSON, withPictures, type PicturePage } from "./pictures";
import { avatarInitial, profileStats, subscriptionLine } from "./profile";
import { buildPractice, buildPracticeTest, buildSession } from "./session";
import { newSrs } from "./srs";
import type { Card, Lesson, Library } from "./types";
import { emptyLibrary } from "./library";

const NOW = new Date("2026-10-20T12:00:00Z");

const fact = (statement: string, pageId?: string): FactDraft => ({
  pageId,
  statement,
  cloze: statement.split(" ")[1],
  question: statement,
  answer: statement.split(" ")[1],
  distractors: [],
  falseStatement: statement,
});

// A seeded random so the session rules are checked over many shuffles.
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe("picture cards (11.2)", () => {
  const result: BuildResult = {
    lessons: [
      { title: "Cells", summary: "", cards: [fact("Mitochondria make ATP for the cell.", "p1"), fact("Ribosomes build proteins from amino acids.", "p2")] },
      { title: "Stoics", summary: "", cards: [fact("Virtue is the only good for the Stoics.", "p3")] },
    ],
    quotes: [],
  };

  it("joins the lesson that has cards from its page", () => {
    const pages: PicturePage[] = [{ id: "p1", text: "Mitochondria diagram", kind: "photo", image: "img1" }];
    const out = withPictures(result, pages);
    expect(out.lessons[0].pictures).toEqual([{ pageId: "p1", statement: "Mitochondria diagram", question: "What does this page show?" }]);
    expect(out.lessons).toHaveLength(2);
  });

  it("else joins the closest lesson, else a Pictures lesson", () => {
    const pages: PicturePage[] = [
      { id: "w1", text: "Stoics virtue chart", heading: "Virtue", kind: "photo", image: "img2" },
      { id: "w2", text: "Grocery prices table", kind: "photo", image: "img3" },
    ];
    const out = withPictures(result, pages);
    expect(out.lessons[1].pictures?.map((p) => p.pageId)).toEqual(["w1"]);
    expect(out.lessons[1].pictures?.[0].question).toBe("What's on this page about Virtue?");
    expect(out.lessons[2].title).toBe(PICTURES_LESSON);
    expect(out.lessons[2].pictures?.map((p) => p.pageId)).toEqual(["w2"]);
  });

  it("only photos and low-text screenshots with an image count", () => {
    const pages: PicturePage[] = [
      { id: "a", text: "no image", kind: "photo" },
      { id: "b", text: "word ".repeat(60), kind: "screenshot", image: "x" },
      { id: "c", text: "A small diagram", kind: "screenshot", image: "y" },
      { id: "d", text: "A note", kind: "note", image: "z" },
    ];
    const out = withPictures({ lessons: [], quotes: [] }, pages);
    expect(out.lessons.flatMap((l) => l.pictures ?? []).map((p) => p.pageId)).toEqual(["c"]);
  });

  it("max 12 per lesson", () => {
    const pages: PicturePage[] = Array.from({ length: 14 }, (_, i) => ({ id: `q${i}`, text: `Photo ${i}`, kind: "photo" as const, image: `i${i}` }));
    const out = withPictures({ lessons: [], quotes: [] }, pages);
    expect(out.lessons.map((l) => [l.title, l.pictures?.length])).toEqual([
      ["Pictures", 12],
      ["Pictures 2", 2],
    ]);
  });

  it("photo pages build picture cards through buildProject and materialize", () => {
    const text = "Photosynthesis turns light into sugar in the leaf.\nChlorophyll absorbs the red and blue light in plants.\nThe Calvin cycle fixes carbon dioxide into sugar molecules.";
    const r = buildProject({ title: "Plants", type: "class" }, [{ id: "ph", text, kind: "photo", image: "img", heading: "Photosynthesis" }]);
    const built = materialize("proj", r, [], { now: NOW });
    const pics = built.cards.filter((c) => c.kind === "picture");
    expect(pics).toHaveLength(1);
    expect(pics[0]).toMatchObject({ pageId: "ph", question: "What's on this page about Photosynthesis?" });
    expect(built.lessons.find((l) => l.id === pics[0].lessonId)?.title).not.toBe(PICTURES_LESSON);
  });

  it("word list photos never become picture cards", () => {
    const r = buildProject({ title: "Words" }, [{ id: "w", text: "sonder - a feeling\nlimerence - a crush", kind: "photo", image: "img", words: [{ term: "sonder", definition: "a feeling" }, { term: "limerence", definition: "a crush" }] }]);
    expect(r.lessons.flatMap((l) => l.pictures ?? [])).toEqual([]);
  });
});

describe("picture exercises in sessions (11.2)", () => {
  const lesson: Lesson = { id: "L", projectId: "P", title: "Cells", summary: "", kind: "theme", order: 0, level: 0, sessions: 0 };
  const facts: Card[] = Array.from({ length: 10 }, (_, i) => ({
    id: `f${i}`,
    lessonId: "L",
    projectId: "P",
    kind: "fact",
    statement: `Fact number ${i} says the organelle${i} matters for the cell.`,
    cloze: `organelle${i}`,
    question: `Fact number ${i} says the ____ matters for the cell.`,
    answer: `organelle${i}`,
    distractors: ["alpha", "beta", "gamma"],
    falseStatement: `Fact number ${i} says the alpha matters for the cell.`,
    srs: newSrs(NOW),
  }));
  const pics: Card[] = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, lessonId: "L", projectId: "P", pageId: `pg${i}`, kind: "picture", statement: `Diagram ${i}`, question: "What does this page show?", srs: newSrs(NOW) }));
  const profile = emptyLibrary().profile;

  it("at most 3, never first, session still 10 long", () => {
    for (let seed = 1; seed < 40; seed++) {
      const ex = buildSession(lesson, [...facts, ...pics], profile, NOW, rng(seed));
      expect(ex).toHaveLength(10);
      expect(ex[0].type).not.toBe("picture");
      expect(ex.filter((e) => e.type === "picture")).toHaveLength(3);
      // Picture cards never feed other exercise types.
      expect(ex.filter((e) => e.type !== "picture").flatMap((e) => e.cardIds).some((id) => id.startsWith("p"))).toBe(false);
    }
  });

  it("a lesson of only pictures plays them all", () => {
    const ex = buildSession({ ...lesson, title: "Pictures" }, pics, profile, NOW, rng(3));
    expect(ex.map((e) => e.type)).toEqual(Array(6).fill("picture"));
  });

  it("practice includes due pictures, max 3, never first", () => {
    for (let seed = 1; seed < 20; seed++) {
      const due = (c: Card): Card => ({ ...c, srs: { ...c.srs, state: "review", reps: 1, interval: 1, due: "2026-10-19T00:00:00.000Z" } });
      const ex = buildPractice([...facts, ...pics].map(due), NOW, rng(seed));
      expect(ex).toHaveLength(12);
      expect(ex[0].type).not.toBe("picture");
      expect(ex.filter((e) => e.type === "picture")).toHaveLength(3);
    }
  });

  it("practice tests skip picture cards", () => {
    const ex = buildPracticeTest([lesson], [...facts, ...pics], rng(5));
    expect(ex.some((e) => e.type === "picture")).toBe(false);
    expect(ex).toHaveLength(10);
  });
});

describe("loading and profile (11.3)", () => {
  it("old libraries load, picture cards and profile.name round trip", () => {
    const old = normalizeLibrary(structuredClone(sample) as RawLibrary, NOW);
    expect(old.cards.every((c) => c.kind === "fact" || c.kind === "quote")).toBe(true);
    expect(old.profile.name).toBeUndefined();
    const lib: Library = {
      ...old,
      profile: { ...old.profile, name: "Sam" },
      cards: [...old.cards, { id: "pc", lessonId: old.lessons[0].id, projectId: old.projects[0].id, pageId: "x", kind: "picture", statement: "A diagram", question: "What does this page show?", srs: newSrs(NOW) }],
    };
    const again = normalizeLibrary(JSON.parse(JSON.stringify(lib)), NOW);
    expect(again.profile.name).toBe("Sam");
    expect(again.cards.find((c) => c.id === "pc")?.kind).toBe("picture");
  });

  it("subscription line", () => {
    expect(subscriptionLine({ active: true, status: "comp", source: "comp" }, NOW)).toBe("Free for you");
    expect(subscriptionLine({ active: true, status: "trialing", trialEndsAt: "2026-10-25T12:00:00Z" }, NOW)).toBe("Free trial: 5 days left");
    expect(subscriptionLine({ active: true, status: "trialing", trialEndsAt: "2026-10-21T12:00:00Z" }, NOW)).toBe("Free trial: 1 day left");
    expect(subscriptionLine({ active: true, status: "active", renewsAt: "2026-11-20T12:00:00Z" }, NOW)).toBe("OpenStudy Plus, renews Nov 20");
    expect(subscriptionLine({ active: false, status: "expired" }, NOW)).toBe("Not subscribed");
    expect(subscriptionLine({ active: false, status: "none" }, NOW)).toBe("Not subscribed");
  });

  it("stats and avatar", () => {
    const lib = normalizeLibrary(structuredClone(sample) as RawLibrary, NOW);
    const withEvents: Library = {
      ...lib,
      events: [
        { t: "2026-10-02T10:00:00Z", name: "session_done" },
        { t: "2026-10-01T09:00:00Z", name: "onboarding_done" },
      ],
      cards: lib.cards.map((c, i) => (i < 3 ? { ...c, srs: { ...c.srs, reps: 1 } } : c)),
    };
    const s = profileStats(withEvents, NOW);
    expect(s).toMatchObject({ projects: 0, cardsLearned: 3, sessions: 1, memberSince: "2026-10-01T09:00:00Z" });
    expect(avatarInitial("sam", "x@y.z")).toBe("S");
    expect(avatarInitial("", "ann@x.com")).toBe("A");
    expect(avatarInitial(undefined, undefined)).toBeNull();
  });
});

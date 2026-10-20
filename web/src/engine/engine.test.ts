import { describe, expect, it } from "vitest";
import sample from "../data/sample-library.json";
import { buildOffline, quoteCandidates } from "./builder";
import { checkTyped, levenshtein, scoreQuote } from "./check";
import { chunkQuote, checkAnswer, letterHint } from "./exercises";
import { groupPages } from "./grouping";
import { addSample, emptyLibrary, exportLibrary, materialize, mergeLibrary, normalizeLibrary } from "./library";
import { parseNotes } from "./notes";
import { cleanOcr, joinLines } from "./ocr-clean";
import { answerCurrent, buildPractice, buildSession, current, isFinished, progress, startSession } from "./session";
import { review, newSrs } from "./srs";
import { splitSentences, stem } from "./text";
import type { Profile, Stats } from "./types";
import { seeded } from "./util";
import { addXP, displayStreak, sessionXP, touchStreak } from "./xp";

const lib = normalizeLibrary(sample as never, new Date("2026-10-10T12:00:00Z"));
const profile: Profile = { onboarded: true, bringing: ["books"], goals: ["ideas", "quotes"], practice: ["tap"], dailyGoalXP: 20 };

describe("notes parsing", () => {
  it("splits multiple Excerpt From footers into separate pages", () => {
    const blob = `“The only way to get the best of an argument is to avoid it.”

Excerpt From
How to Win Friends and Influence People
Dale Carnegie
This material may be protected by copyright.

“You have power over your mind, not outside events. Realize this, and you will find strength.”

Excerpt From
Meditations
Marcus Aurelius
This material may be protected by copyright.

Smile.

Excerpt From
How to Win Friends and Influence People
Dale Carnegie
This material may be protected by copyright.`;
    const out = parseNotes(blob);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      text: "The only way to get the best of an argument is to avoid it.",
      suggestedTitle: "How to Win Friends and Influence People",
      suggestedAuthor: "Dale Carnegie",
      verbatim: true,
    });
    expect(out[1].suggestedTitle).toBe("Meditations");
    expect(out[1].suggestedAuthor).toBe("Marcus Aurelius");
    expect(out[2].text).toBe("Smile.");
  });

  it("handles CRLF and a missing author line", () => {
    const out = parseNotes("Some excerpt text here.\r\n\r\nExcerpt From\r\nA Book\r\nThis material may be protected by copyright.");
    expect(out).toEqual([{ text: "Some excerpt text here.", suggestedTitle: "A Book", suggestedAuthor: undefined, verbatim: true }]);
  });

  it("falls back to paragraphs with a short first line as title", () => {
    const out = parseNotes("Atomic Habits\n\nHabits are the compound interest of self-improvement.\n\n- You do not rise to the level of your goals.\n- You fall to the level of your systems.");
    expect(out.map((o) => o.text)).toEqual([
      "Habits are the compound interest of self-improvement.",
      "You do not rise to the level of your goals.",
      "You fall to the level of your systems.",
    ]);
    expect(out.every((o) => o.suggestedTitle === "Atomic Habits")).toBe(true);
  });
});

describe("sentence split and text", () => {
  it("keeps abbreviations together", () => {
    expect(splitSentences("Mr. Smith met Dr. Jones at noon. They talked, e.g. about books. Then they left!")).toEqual([
      "Mr. Smith met Dr. Jones at noon.",
      "They talked, e.g. about books.",
      "Then they left!",
    ]);
  });
  it("splits after closing quotes", () => {
    expect(splitSentences('Never say, "You\'re wrong." If you are wrong, admit it.')).toEqual(['Never say, "You\'re wrong."', "If you are wrong, admit it."]);
  });
  it("stems lightly", () => {
    expect(stem("criticizing")).toBe("criticiz");
    expect(stem("people")).toBe("people");
    expect(stem("friends")).toBe("friend");
    expect(stem("does")).toBe("does");
  });
});

describe("ocr cleaning", () => {
  it("drops status bar, uses top lines as header, joins hyphens, drops footer", () => {
    const H = 2000;
    const body = "Criticism is futile because it puts a person on the defen-|sive and usually makes him strive to justify himself. Criticism is dangerous, because it wounds a person's precious pride, hurts his sense of importance, and arouses resentment. Any fool can criticize, condemn and complain, and most fools do.";
    const lines = [
      { text: "9:41", top: 10, bottom: 40 },
      { text: "Fundamental Techniques", top: 120, bottom: 150 },
      ...body.split("|").map((t, i) => ({ text: t, top: 400 + i * 60, bottom: 440 + i * 60 })),
      { text: "12 of 280", top: 1900, bottom: 1940 },
    ];
    const out = cleanOcr(lines, H);
    expect(out.header).toBe("Fundamental Techniques");
    expect(out.text).toContain("defensive and usually");
    expect(out.text).not.toContain("280");
    expect(out.skipped).toBe(false);
  });
  it("skips non-book screenshots", () => {
    expect(cleanOcr([{ text: "Settings General Wi-Fi", top: 500, bottom: 520 }], 2000).skipped).toBe(true);
  });
  it("joins wrapped lines", () => {
    expect(joinLines(["exam-", "ple text", "", "next para"])).toBe("example text\n\nnext para");
  });
});

describe("offline builder", () => {
  const pages = lib.pages.filter((p) => p.projectId === "smpcarnegi").map((p) => ({ id: p.id, text: p.text, header: p.header, verbatim: p.kind === "note" }));
  const res = buildOffline({ title: "How to Win Friends", author: "Dale Carnegie" }, pages);

  it("produces lessons with fact cards", () => {
    expect(res.lessons.length).toBeGreaterThanOrEqual(1);
    for (const l of res.lessons) {
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.summary.length).toBeLessThanOrEqual(121);
      expect(l.cards.length).toBeGreaterThan(0);
      expect(l.cards.length).toBeLessThanOrEqual(14);
      for (const c of l.cards) {
        expect(c.statement.toLowerCase()).toContain(c.cloze.toLowerCase());
        expect(c.question).toContain("____");
        expect(c.distractors).toHaveLength(3);
        expect(c.falseStatement).not.toBe(c.statement);
      }
    }
  });

  it("groups by chapter header when two headers cover 3+ sentences", () => {
    const titles = res.lessons.map((l) => l.title);
    expect(titles).toContain("Fundamental Techniques in Handling People");
    expect(titles).toContain("Six Ways to Make People Like You");
  });

  it("finds quote candidates including verbatim note excerpts", () => {
    expect(res.quotes.length).toBeGreaterThan(2);
    expect(res.quotes.length).toBeLessThanOrEqual(20);
    expect(res.quotes.some((q) => q.text.startsWith("The only way to get the best of an argument"))).toBe(true);
    expect(res.quotes.every((q) => q.attribution === "Dale Carnegie")).toBe(true);
  });

  it("uses k-means terms as titles without headers", () => {
    const ap = lib.pages.filter((p) => p.projectId === "smpaurelis").map((p) => ({ id: p.id, text: p.text }));
    const r = buildOffline({ title: "Meditations" }, ap);
    expect(r.lessons.length).toBeGreaterThanOrEqual(1);
    expect(r.lessons[0].title).toMatch(/^[A-Z][a-z']+ & [A-Z][a-z']+$/);
  });

  it("imperative and aphorism detection", () => {
    const q = quoteCandidates([{ id: "x", text: "Remember that a name is the sweetest sound in any language. The weather was nice and warm today in town." }]);
    expect(q.map((x) => x.text)).toEqual(["Remember that a name is the sweetest sound in any language."]);
  });

  it("materializes lessons with Quotes after the first lesson", () => {
    const m = materialize("p1", res, res.quotes.slice(0, 3));
    expect(m.lessons[1].kind).toBe("quotes");
    expect(m.lessons.map((l) => l.order)).toEqual(m.lessons.map((_, i) => i));
    expect(m.cards.filter((c) => c.kind === "quote")).toHaveLength(3);
    expect(m.cards.every((c) => c.srs.state === "new")).toBe(true);
  });
});

describe("grouping", () => {
  it("groups by suggested title, then headers, orphans by similarity", () => {
    const g = groupPages([
      { id: "a", text: "x", suggestedTitle: "Meditations", suggestedAuthor: "Marcus Aurelius" },
      { id: "b", text: "y", suggestedTitle: "meditations" },
      { id: "c", text: "criticism resentment pride people defensive", header: "Chapter 1: Handling People" },
      { id: "d", text: "criticism condemn complain fools people", header: "Chapter 1 Handling People" },
      { id: "e", text: "criticism people pride resentment condemn", header: "Something Else" },
      { id: "f", text: "quantum chromodynamics gluon lattice", header: "" },
    ]);
    const med = g.find((x) => x.title === "Meditations")!;
    expect(med.pageIds).toEqual(["a", "b"]);
    expect(med.author).toBe("Marcus Aurelius");
    const ch = g.find((x) => x.pageIds.includes("c"))!;
    expect(ch.pageIds).toContain("d");
    expect(ch.pageIds).toContain("e");
    expect(g.find((x) => x.title === "Unsorted")!.pageIds).toEqual(["f"]);
  });
});

describe("grouping with persisted sort edits", () => {
  it("merges a moved page into its header group and keeps Unsorted last", () => {
    const g = groupPages([
      { id: "a", text: "x", header: "Walden" },
      { id: "b", text: "y", header: "Walden" },
      { id: "c", text: "z", header: "Other", suggestedTitle: "Walden", suggestedAuthor: "Thoreau" },
      { id: "d", text: "w", suggestedTitle: "Unsorted" },
      { id: "e", text: "v", suggestedTitle: "Meditations" },
    ]);
    expect(g.find((x) => x.title === "Walden")!.pageIds.sort()).toEqual(["a", "b", "c"]);
    expect(g.find((x) => x.title === "Walden")!.author).toBe("Thoreau");
    expect(g[g.length - 1]).toMatchObject({ title: "Unsorted", pageIds: ["d"] });
  });
});

describe("srs", () => {
  const now = new Date(2026, 9, 10, 15, 0, 0);
  it("again sends a card to learning in 10 minutes", () => {
    const s = review(newSrs(now), "again", now);
    expect(s.state).toBe("learning");
    expect(new Date(s.due).getTime() - now.getTime()).toBe(10 * 60000);
    expect(s.lapses).toBe(0);
    expect(s.ease).toBeCloseTo(2.3);
  });
  it("good progresses 1, 3, then interval*ease", () => {
    let s = review(newSrs(now), "good", now);
    expect(s).toMatchObject({ reps: 1, interval: 1, state: "review" });
    expect(new Date(s.due)).toEqual(new Date(2026, 9, 11));
    s = review(s, "good", now);
    expect(s.interval).toBe(3);
    s = review(s, "good", now);
    expect(s.interval).toBe(8); // round(3 * 2.5)
    s = review(s, "again", now);
    expect(s).toMatchObject({ reps: 0, lapses: 1, interval: 0, state: "learning" });
  });
  it("hard and easy adjust ease with clamps", () => {
    let s = { ...newSrs(now), ease: 1.35 };
    s = review(s, "hard", now);
    expect(s.ease).toBe(1.3);
    let e = { ...newSrs(now), ease: 2.95, reps: 2, interval: 3 };
    e = review(e, "easy", now);
    expect(e.ease).toBe(3);
    expect(e.interval).toBe(Math.round(3 * 2.95 * 1.3));
  });
});

describe("answer checking", () => {
  it("levenshtein", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
  });
  it("normalizes and accepts close spellings", () => {
    expect(checkTyped("The Resentment!", "resentment")).toBe("correct");
    expect(checkTyped("resentmant", "resentment")).toBe("close");
    expect(checkTyped("gratitude", "resentment")).toBe("wrong");
    expect(checkTyped("fase", "face")).toBe("close");
    expect(checkTyped("", "face")).toBe("wrong");
  });
  it("scores quotes by word LCS", () => {
    const t = "The only way to get the best of an argument is to avoid it.";
    expect(scoreQuote("the only way to get the best of an argument is to avoid it", t).verdict).toBe("correct");
    const close = scoreQuote("The only way to get the best of argument is avoid it", t);
    expect(close.verdict).toBe("close");
    expect(close.diff.filter((d) => d.status === "missing").map((d) => d.word)).toEqual(["an", "to"]);
    expect(scoreQuote("avoid arguments", t).verdict).toBe("wrong");
    const extra = scoreQuote("The only way to get the very best of an argument is to avoid it.", t);
    expect(extra.diff.find((d) => d.status === "extra")?.word).toBe("very");
  });
  it("letter hints and chunking", () => {
    expect(letterHint("A fool can complain.")).toBe("A f___ c__ c_______.");
    const chunks = chunkQuote("Waste no more time arguing about what a good man should be. Be one.");
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.length).toBeLessThanOrEqual(5);
    expect(chunks.join(" ")).toBe("Waste no more time arguing about what a good man should be. Be one.");
  });
});

describe("xp and streaks", () => {
  const base: Stats = { xp: 0, streak: 0, longestStreak: 0, freezes: 0, dayXP: {} };
  it("starts, continues and resets", () => {
    let s = touchStreak(base, "2026-10-01");
    expect(s.streak).toBe(1);
    s = touchStreak(s, "2026-10-01");
    expect(s.streak).toBe(1);
    s = touchStreak(s, "2026-10-02");
    expect(s.streak).toBe(2);
    s = touchStreak(s, "2026-10-05");
    expect(s.streak).toBe(1);
    expect(s.longestStreak).toBe(2);
  });
  it("uses a freeze for a one day gap", () => {
    const s = touchStreak({ ...base, streak: 4, longestStreak: 4, freezes: 1, lastActiveDay: "2026-10-01" }, "2026-10-03");
    expect(s.streak).toBe(5);
    expect(s.freezes).toBe(0);
    const n = touchStreak({ ...base, streak: 4, freezes: 0, lastActiveDay: "2026-10-01" }, "2026-10-03");
    expect(n.streak).toBe(1);
  });
  it("grants a freeze every 7th day, max 2", () => {
    let s: Stats = { ...base, streak: 6, freezes: 1, lastActiveDay: "2026-10-06" };
    s = touchStreak(s, "2026-10-07");
    expect(s.streak).toBe(7);
    expect(s.freezes).toBe(2);
    s = touchStreak({ ...s, streak: 13 }, "2026-10-08");
    expect(s.streak).toBe(14);
    expect(s.freezes).toBe(2);
  });
  it("crosses month boundaries and records day XP", () => {
    let s = addXP({ ...base, streak: 3, lastActiveDay: "2026-09-30" }, 12, new Date(2026, 9, 1, 9));
    expect(s.streak).toBe(4);
    expect(s.dayXP["2026-10-01"]).toBe(12);
    s = addXP(s, 5, new Date(2026, 9, 1, 20));
    expect(s.dayXP["2026-10-01"]).toBe(17);
    expect(s.xp).toBe(17);
    expect(displayStreak(s, new Date(2026, 9, 4))).toBe(0);
  });
  it("session xp", () => {
    expect(sessionXP({ correctFirst: 10, applyCorrect: 0, mistakes: 0, completed: true })).toBe(25);
    expect(sessionXP({ correctFirst: 8, applyCorrect: 1, mistakes: 2, completed: true })).toBe(21);
  });
});

describe("sessions", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const lesson = lib.lessons.find((l) => l.id === "lc1")!;

  it("builds 10 exercises for a theme lesson, never type first, no double match", () => {
    for (let seed = 1; seed < 30; seed++) {
      const ex = buildSession({ ...lesson, level: seed % 5 }, lib.cards, { ...profile, practice: ["tap", "type"] }, now, seeded(seed));
      expect(ex.length).toBeGreaterThan(0);
      expect(ex.length).toBeLessThanOrEqual(10);
      expect(ex[0].type).not.toBe("type");
      for (let i = 1; i < ex.length; i++) expect(ex[i].type === "match" && ex[i - 1].type === "match").toBe(false);
      const uses = new Map<string, number>();
      ex.forEach((e) => e.cardIds.forEach((id) => uses.set(id, (uses.get(id) ?? 0) + 1)));
      for (const n of uses.values()) expect(n).toBeLessThanOrEqual(2);
    }
  });

  it("keeps small lessons from being eaten by match exercises", () => {
    const five = lib.cards.filter((c) => c.lessonId === "lc2"); // 5 cards
    for (let seed = 1; seed < 20; seed++) {
      const ex = buildSession({ ...lesson, id: "lc2" }, five, profile, now, seeded(seed));
      expect(ex.filter((e) => e.type === "match").length).toBeLessThanOrEqual(1);
      expect(ex.length).toBeGreaterThanOrEqual(6);
    }
  });

  it("builds 8 quote exercises", () => {
    const q = lib.lessons.find((l) => l.id === "lcq")!;
    const ex = buildSession(q, lib.cards, profile, now, seeded(3));
    expect(ex).toHaveLength(8);
    expect(ex.every((e) => e.type === "q-bank1")).toBe(true);
  });

  it("re-queues mistakes until everything is answered correctly once", () => {
    const ex = buildSession(lesson, lib.cards, profile, now, seeded(7));
    let s = startSession(ex);
    const firstId = current(s)!.id;
    s = answerCurrent(s, "wrong", "again").state;
    expect(s.queue[s.queue.length - 1].id).toBe(firstId);
    expect(progress(s)).toBe(0);
    let steps = 0;
    while (!isFinished(s) && steps++ < 100) s = answerCurrent(s, "correct", "good").state;
    expect(isFinished(s)).toBe(true);
    expect(s.correct).toBe(ex.length);
    expect(s.mistakes).toBe(1);
    expect(s.correctFirst).toBe(ex.length - 1);
    expect(progress(s)).toBe(1);
  });

  it("grades each card only on its first attempt", () => {
    const ex = buildSession(lesson, lib.cards, profile, now, seeded(9));
    let s = startSession(ex);
    const ids = current(s)!.cardIds;
    const r1 = answerCurrent(s, "wrong", "again");
    expect(Object.keys(r1.newlyGraded)).toEqual(ids);
    s = r1.state;
    while (current(s)!.id !== ex[0].id) s = answerCurrent(s, "correct", "good").state;
    const r2 = answerCurrent(s, "correct", "good");
    expect(Object.keys(r2.newlyGraded).filter((id) => ids.includes(id))).toEqual([]);
  });

  it("practice only uses due cards", () => {
    expect(buildPractice(lib.cards, now)).toEqual([]);
    const reviewed = lib.cards.map((c, i) => (i < 3 ? { ...c, srs: { ...review(c.srs, "good", new Date("2026-10-01")), due: "2026-10-02T00:00:00.000Z" } } : c));
    const ex = buildPractice(reviewed, now, seeded(1));
    expect(ex.length).toBe(6);
    expect(new Set(ex.flatMap((e) => e.cardIds)).size).toBe(3);
  });

  it("checks every generated exercise against its own solution", () => {
    const ex = buildSession({ ...lesson, level: 2 }, lib.cards, profile, now, seeded(11));
    for (const e of ex) {
      if (e.type === "mc") expect(checkAnswer(e, { kind: "choice", value: e.answer }).verdict).toBe("correct");
      if (e.type === "bank") expect(checkAnswer(e, { kind: "slots", value: e.answers }).verdict).toBe("correct");
      if (e.type === "type") expect(checkAnswer(e, { kind: "text", value: e.answer }).verdict).toBe("correct");
    }
  });
});

describe("library merge", () => {
  it("adds sample once and round-trips export/import", () => {
    let l = addSample(emptyLibrary(), sample as never);
    l = addSample(l, sample as never);
    expect(l.projects).toHaveLength(3);
    const json = JSON.parse(JSON.stringify(exportLibrary(l)));
    const merged = mergeLibrary(emptyLibrary(), normalizeLibrary(json));
    expect(merged.cards).toHaveLength(l.cards.length);
    expect(merged.lessons).toEqual(l.lessons);
  });
});

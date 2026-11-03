import { describe, expect, it } from "vitest";
import { adaptiveFollowups, masteryScore, nextLevel, readAttempts, record, weakest, EMPTY_MASTERY, type Attempt } from "./adaptive";
import { blockSchema, validateBlocks, type Question } from "./blocks";
import { demoCritic, demoGenerator, demoReply, plotRequest, solveQuadratic } from "./demo";
import { PACKS } from "./demo-packs";
import { layoutDiagram } from "./diagram";
import { autoRange, checkExpr, compile, sample, ticks } from "./expr";
import { runPipeline, type Critic, type Generator } from "./pipeline";
import { buildStudyPlan } from "./plan";
import { inline, prose } from "./prose";
import { critiquePasses, RUBRIC, type Critique } from "./rubric";
import { gradeAnswer, makeFlashcards, makeQuiz, tutorChat, type Ai } from "./service";
import { validateQuestion, type IssueCode } from "./validator";

const good = (over: Partial<Question> = {}): Question => ({
  id: "q1",
  concept: "Levers",
  difficulty: 3,
  skill: "predict",
  stem: "Doubling the distance from the pivot does what to the force needed?",
  options: [
    { id: "a", text: "It halves it", correct: true, explanation: "Torque is force times distance, so twice the distance needs half the force." },
    { id: "b", text: "It doubles it", correct: false, explanation: "This reverses the relationship: more distance gives more turning effect per newton." },
    { id: "c", text: "It stays equal", correct: false, explanation: "This ignores distance, but torque depends on both force and distance." },
    { id: "d", text: "It quadruples it", correct: false, explanation: "This squares the distance, which applies to areas and not to torque." },
  ],
  ...over,
});
const codes = (q: unknown) => validateQuestion(q).map((i) => i.code);
const opts = (fn: (o: Question["options"]) => Question["options"]) => good({ options: fn(good().options) });

describe("question validator", () => {
  it("passes a well formed question", () => expect(codes(good())).toEqual([]));

  const bad: [string, unknown, IssueCode][] = [
    ["schema: missing stem", { ...good(), stem: undefined }, "schema"],
    ["schema: difficulty out of range", good({ difficulty: 6 }), "schema"],
    ["three options", opts((o) => o.slice(0, 3)), "option_count"],
    ["five ids out of order", opts((o) => [o[1], o[0], o[2], o[3]]), "option_ids"],
    ["duplicate options", opts((o) => [o[0], o[1], { ...o[2], text: "IT DOUBLES IT." }, o[3]]), "duplicate_options"],
    ["no correct option", opts((o) => o.map((x) => ({ ...x, correct: false }))), "correct_count"],
    ["two correct options", opts((o) => o.map((x, i) => ({ ...x, correct: i < 2 }))), "correct_count"],
    ["empty-ish explanation", opts((o) => [o[0], { ...o[1], explanation: "Wrong." }, o[2], o[3]]), "missing_explanation"],
    ["copied explanation", opts((o) => [o[0], o[1], { ...o[2], explanation: o[1].explanation }, o[3]]), "copied_explanation"],
    ["all of the above", opts((o) => [o[0], o[1], o[2], { ...o[3], text: "All of the above" }]), "catch_all_option"],
    ["none of these", opts((o) => [o[0], o[1], o[2], { ...o[3], text: "None of these" }]), "catch_all_option"],
    ["both a and b", opts((o) => [o[0], o[1], o[2], { ...o[3], text: "Both A and B" }]), "catch_all_option"],
    ["stem contains answer", good({ stem: "If it halves it, what happens to the force needed?" }), "answer_in_stem"],
    [
      "clue word",
      good({
        stem: "What drives mitochondrial respiration?",
        options: [
          { id: "a", text: "Mitochondrial enzymes", correct: true, explanation: "Enzymes in the organelle run the reaction chain for the cell." },
          { id: "b", text: "Ribosomal proteins", correct: false, explanation: "Ribosomes build proteins and have no role in this pathway." },
          { id: "c", text: "Nuclear transcripts", correct: false, explanation: "Transcripts carry code and do not run reactions themselves." },
          { id: "d", text: "Membrane lipids", correct: false, explanation: "Lipids form the barrier and do not catalyse these reactions." },
        ],
      }),
      "word_clue",
    ],
    ["padded right answer", opts((o) => [{ ...o[0], text: "It halves it, because torque is force multiplied by distance from the pivot" }, o[1], o[2], o[3]]), "length_balance"],
    ["statement stem", good({ stem: "Torque depends on distance." }), "not_a_question"],
    ["quiet negative", good({ stem: "Which of these does not change torque?" }), "negative_stem"],
  ];
  it.each(bad)("rejects %s", (_n, q, code) => expect(codes(q)).toContain(code));

  it("leaves short numeric options alone", () => {
    const q = good({
      stem: "What is 6 times 7?",
      options: [
        { id: "a", text: "42", correct: true, explanation: "Six sevens make forty two by repeated addition." },
        { id: "b", text: "13", correct: false, explanation: "This adds the numbers when the question multiplies them." },
        { id: "c", text: "36", correct: false, explanation: "This squares six and forgets about the seven entirely." },
        { id: "d", text: "48", correct: false, explanation: "This is six eights, a slip of one row in the table." },
      ],
    });
    expect(codes(q)).toEqual([]);
  });
  it("accepts a capitalised negative", () => expect(codes(good({ stem: "Which change does NOT alter the force needed?" }))).toEqual([]));
});

describe("every demo question", () => {
  const all = PACKS.flatMap((p) => p.questions.map((q) => [q.id, q] as const));
  it.each(all)("%s passes the validator", (_id, q) => expect(validateQuestion(q)).toEqual([]));
  it("each pack covers every difficulty", () => {
    for (const p of PACKS) expect(p.questions.map((q) => q.difficulty).sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it("the right answer is not always in one position", () => {
    const at = new Set(PACKS.flatMap((p) => p.questions).map((q) => q.options.findIndex((o) => o.correct)));
    expect(at.size).toBe(4);
  });
  it.each(PACKS.map((p) => [p.id, p] as const))("%s blocks pass the schema", (_id, p) => {
    expect(validateBlocks(p.blocks).dropped).toEqual([]);
  });
});

describe("adaptivity", () => {
  const go = (level: number, results: boolean[]): Attempt[] => results.map((correct, i) => ({ concept: "x", difficulty: level, correct, at: String(i) }));

  it("starts at level 2 and says so", () => expect(nextLevel([])).toMatchObject({ level: 2, direction: "start" }));
  it("needs evidence before it moves", () => expect(nextLevel(go(3, [true, true]))).toMatchObject({ level: 3, direction: "hold" }));
  it("steps up on 4 of 5", () => expect(nextLevel(go(3, [true, true, false, true, true]))).toMatchObject({ level: 4, direction: "up" }));
  it("steps down on 2 of 5", () => expect(nextLevel(go(3, [false, true, false, true, false]))).toMatchObject({ level: 2, direction: "down" }));
  it("holds on 3 of 5", () => expect(nextLevel(go(3, [true, false, true, false, true]))).toMatchObject({ level: 3, direction: "hold" }));
  it("never leaves 1 to 5", () => {
    expect(nextLevel(go(5, [true, true, true, true, true])).level).toBe(5);
    expect(nextLevel(go(1, [false, false, false])).level).toBe(1);
  });
  it("only the recent window counts", () => {
    const old = go(3, Array(10).fill(false));
    expect(nextLevel([...old, ...go(3, Array(5).fill(true))]).level).toBe(4);
  });
  it("reasons name the real count", () => expect(nextLevel(go(2, [true, true, true])).reason).toContain("3 of your last 3"));
  it("mastery rewards hard right answers over easy ones", () => {
    expect(masteryScore(go(5, [false, true, true]))).toBeGreaterThan(masteryScore(go(1, [false, true, true])));
  });
  it("mastery cannot be proved by one answer", () => expect(masteryScore(go(5, [true]))).toBeLessThan(0.5));
  it("recent answers weigh more", () => {
    expect(masteryScore(go(3, [false, false, true, true]))).toBeGreaterThan(masteryScore(go(3, [true, true, false, false])));
  });
  it("orders concepts weakest first and is case blind", () => {
    let m = EMPTY_MASTERY;
    for (const [concept, correct] of [["Strong", true], ["strong", true], ["STRONG", true], ["Weak", false], ["Weak", false], ["Weak", true]] as const) m = record(m, { concept, difficulty: 2, correct, at: "" });
    expect(weakest(m).map((w) => w.concept)).toEqual(["Weak", "STRONG"]);
  });
  it("follow-ups react to a miss", () => {
    const f = adaptiveFollowups("x", go(3, [false, false, false]), "Why does it fall?");
    expect(f.items[0].prompt).toContain("Why does it fall?");
    expect(f.items.map((i) => i.label)).toContain("More at level 2");
  });
  it("follow-ups offer the next level after a run of right answers", () => {
    expect(adaptiveFollowups("x", go(3, [true, true, true])).items.map((i) => i.label)).toContain("Try level 4");
  });
  it("drops malformed client attempts", () => {
    expect(readAttempts([{ concept: "a", difficulty: 9, correct: true }, null, "x", { concept: "b", difficulty: 2, correct: false, at: "t" }])).toEqual([{ concept: "b", difficulty: 2, correct: false, at: "t" }]);
    expect(readAttempts("nope")).toEqual([]);
  });
});

describe("pipeline", () => {
  const spec = { topic: "Levers", concept: "Levers", count: 2, difficulty: 3 };
  const pass = (id: string): Critique => ({ questionId: id, scores: { understanding: 5, distractors: 5, unambiguous: 5, explanations: 5, difficulty: 5 }, note: "" });
  const passAll: Critic = async (qs) => qs.map((q) => pass(q.id));
  const q2 = good({ id: "q2", stem: "A longer spanner turns a stiff bolt more easily because of what?" });

  it("ships what passes in one round", async () => {
    const gen: Generator = async () => [good(), q2];
    const r = await runPipeline(spec, gen, passAll, "model");
    expect(r.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(r.report).toMatchObject({ rounds: 1, generated: 2, rejected: 0, score: 5 });
  });

  it("regenerates only what failed the validator, passing on why", async () => {
    const seen: string[][] = [];
    const gen: Generator = async (s, feedback) => {
      seen.push(feedback.flatMap((f) => f.problems));
      return feedback.length ? [q2] : [good(), { ...q2, options: q2.options.slice(0, 3) }];
    };
    const r = await runPipeline(spec, gen, passAll, "model");
    expect(r.questions).toHaveLength(2);
    expect(r.report).toMatchObject({ rounds: 2, rejected: 1 });
    expect(seen[1][0]).toContain("option_count");
  });

  it("regenerates what fails the critique", async () => {
    let round = 0;
    const gen: Generator = async () => (++round === 1 ? [good(), q2] : [good({ id: "q3", stem: "Why does a door handle sit far from the hinge?" })]);
    const critic: Critic = async (qs) => qs.map((q) => (q.id === "q2" ? { ...pass(q.id), scores: { ...pass(q.id).scores, unambiguous: 1 }, note: "two defensible answers" } : pass(q.id)));
    const r = await runPipeline(spec, gen, critic, "model");
    expect(r.questions.map((q) => q.id)).toEqual(["q1", "q3"]);
    expect(r.rejections[0]).toMatchObject({ stage: "critique", problems: ["two defensible answers"] });
  });

  it("drops an item that never passes, and stops", async () => {
    let calls = 0;
    const gen: Generator = async () => {
      calls++;
      return [{ ...good(), options: [] }];
    };
    const r = await runPipeline(spec, gen, passAll, "model");
    expect(calls).toBe(3);
    expect(r.questions).toEqual([]);
  });

  it("a question with no critique does not pass", async () => {
    const r = await runPipeline({ ...spec, count: 1 }, async () => [good()], async () => [], "model", 1);
    expect(r.questions).toEqual([]);
    expect(r.rejections[0].problems).toEqual(["no critique returned"]);
  });

  it("rejects a repeated stem", async () => {
    const r = await runPipeline(spec, async () => [good(), good({ id: "dup" })], passAll, "model", 1);
    expect(r.questions).toHaveLength(1);
    expect(r.rejections[0].problems[0]).toContain("duplicate");
  });

  it("does not repeat kept stems to the generator", async () => {
    const avoid: string[][] = [];
    const gen: Generator = async (s) => {
      avoid.push(s.avoid ?? []);
      return avoid.length === 1 ? [good()] : [q2];
    };
    await runPipeline(spec, gen, passAll, "model");
    expect(avoid[1]).toEqual([good().stem]);
  });

  it("rubric floor catches one weak criterion in a high mean", () => {
    expect(critiquePasses({ ...pass("a"), scores: { ...pass("a").scores, unambiguous: 2 } })).toBe(false);
    expect(RUBRIC.length).toBe(5);
  });

  it("the demo critic rejects a recall stem", async () => {
    const [c] = await demoCritic([good({ stem: "What is the definition of torque?" })], spec);
    expect(critiquePasses(c)).toBe(false);
  });

  it("a demo pack serves the requested level and honours avoid", async () => {
    const pack = PACKS[0];
    const out = (await demoGenerator(pack)({ ...spec, count: 1, difficulty: 4, avoid: [] }, [])) as Question[];
    expect(out[0].difficulty).toBe(4);
    const next = (await demoGenerator(pack)({ ...spec, count: 1, difficulty: 4, avoid: [out[0].stem] }, [])) as Question[];
    expect(next[0].id).not.toBe(out[0].id);
  });
});

describe("expressions", () => {
  const at = (s: string, env: Record<string, number> = {}) => compile(s).eval(env);
  it("evaluates with precedence", () => {
    expect(at("1 + 2 * 3 ^ 2")).toBe(19);
    expect(at("-2^2")).toBe(-4);
    expect(at("2^3^2")).toBe(512);
    expect(at("(1+2)*3")).toBe(9);
  });
  it("handles implied multiplication and functions", () => {
    expect(at("2x", { x: 4 })).toBe(8);
    expect(at("3(x+1)", { x: 1 })).toBe(6);
    expect(at("2 sin(pi/2)")).toBe(2);
    expect(at("max(1, 3, 2)")).toBe(3);
  });
  it("cannot reach anything but numbers", () => {
    for (const bad of ["constructor", "process.exit()", "x[0]", "alert(1)", "toString(1)", "__proto__(x)", "`x`", "a=1"]) expect(checkExpr(bad, ["x"])).not.toBeNull();
  });
  it("lists free names", () => expect(compile("a*x^2 + pi").vars.sort()).toEqual(["a", "x"]));
  it("breaks at asymptotes", () => expect(sample(compile("tan(x)"), "x", -3, 3, {}, 300, 10).length).toBeGreaterThan(1));
  it("gaps where undefined", () => expect(sample(compile("sqrt(x)"), "x", -4, 4, {})[0][0].x).toBeGreaterThanOrEqual(0));
  it("makes a range and round ticks", () => {
    expect(autoRange([])).toEqual([-1, 1]);
    expect(ticks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });
});

describe("blocks", () => {
  const plot = { type: "plot", title: "t", domain: [0, 1], curves: [{ label: "y", expr: "a*x" }], sliders: [{ name: "a", label: "a", min: 0, max: 2, step: 0.1, value: 1 }] };
  it("accepts a generic plot and defaults the variable", () => {
    const r = blockSchema.parse(plot);
    expect(r).toMatchObject({ variable: "x" });
  });
  it("rejects a curve using an undefined name", () => expect(blockSchema.safeParse({ ...plot, sliders: [] }).success).toBe(false));
  it("rejects a slider outside its range", () => {
    expect(blockSchema.safeParse({ ...plot, sliders: [{ ...plot.sliders[0], value: 5 }] }).success).toBe(false);
  });
  it("rejects a diagram edge to nowhere", () => {
    const d = { type: "diagram", title: "t", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "z" }] };
    expect(blockSchema.safeParse(d).success).toBe(false);
  });
  it("drops bad blocks and keeps good ones", () => {
    const r = validateBlocks([{ type: "text", markdown: "ok" }, { type: "video", url: "x" }, null]);
    expect(r.blocks).toHaveLength(1);
    expect(r.dropped).toHaveLength(2);
  });
  it("turns bad LaTeX into plain text", () => {
    const r = validateBlocks([{ type: "formula", latex: "\\frac{1" }]);
    expect(r.blocks[0].type).toBe("text");
  });
  it("a model cannot smuggle a quiz past the pipeline with a bad question", () => {
    const r = validateBlocks([{ type: "quiz", title: "t", concept: "c", questions: [{ stem: "x" }] }]);
    expect(r.blocks).toEqual([]);
  });
});

describe("prose", () => {
  it("reads math, bold and code", () => {
    expect(inline("a **b** `c` $d$")).toEqual([
      { k: "text", v: "a " },
      { k: "bold", v: "b" },
      { k: "text", v: " " },
      { k: "code", v: "c" },
      { k: "text", v: " " },
      { k: "math", v: "d" },
    ]);
  });
  it("keeps math inside bold readable by the renderer", () => {
    const [bold] = inline("**$a$** sets it");
    expect(bold).toEqual({ k: "bold", v: "$a$" });
    expect(inline((bold as { v: string }).v)).toEqual([{ k: "math", v: "a" }]);
  });
  it("leaves prices alone", () => expect(inline("from $5 to $10 today")).toEqual([{ k: "text", v: "from $5 to $10 today" }]));
  it("reads lists and display math", () => {
    expect(prose("- a\n- b\n\n$$x^2$$").map((p) => p.k)).toEqual(["ul", "math"]);
    expect(prose("1. a\n2. b")[0].k).toBe("ol");
  });
});

describe("diagram layout", () => {
  const d = { type: "diagram" as const, title: "t", nodes: Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, label: `Node number ${i}` })), edges: [{ from: "n0", to: "n1" }, { from: "n1", to: "n0" }] };
  it("wraps to fit and never overflows", () => {
    for (const w of [320, 700]) for (const n of layoutDiagram(d, w).nodes) expect(n.x + n.w).toBeLessThanOrEqual(w + 0.5);
  });
  it("no two nodes overlap", () => {
    const { nodes } = layoutDiagram(d, 320);
    for (const a of nodes) for (const b of nodes) if (a !== b) expect(a.y !== b.y || a.x + a.w <= b.x || b.x + b.w <= a.x).toBe(true);
  });
  it("keeps a three way split on one row at phone width, under its parents", () => {
    const tree = {
      type: "diagram" as const,
      title: "t",
      nodes: ["root", "a", "b", "c", "la", "lb", "lc"].map((id) => ({ id, label: id.length > 1 ? `A long leaf label ${id}` : id })),
      edges: [["root", "a"], ["root", "b"], ["root", "c"], ["c", "lc"], ["a", "la"], ["b", "lb"]].map(([from, to]) => ({ from, to })),
    };
    const { nodes } = layoutDiagram(tree, 318);
    const at = (id: string) => nodes.find((n) => n.id === id)!;
    expect(new Set(["la", "lb", "lc"].map((id) => at(id).y)).size).toBe(1);
    expect(at("la").x).toBeLessThan(at("lb").x);
    expect(at("lb").x).toBeLessThan(at("lc").x);
  });
  it("survives a cycle", () => expect(layoutDiagram(d, 320).height).toBeGreaterThan(0));
});

describe("demo replies", () => {
  it("plots any formula and makes sliders from free names", () => {
    expect(plotRequest("plot a*sin(b*x)")).toMatchObject({ type: "plot", curves: [{ expr: "a*sin(b*x)" }] });
    expect(blockSchema.safeParse(plotRequest("graph y = x^3 - 2x")).success).toBe(true);
    expect(plotRequest("draw a picture of a cell")).toBeNull();
  });
  it("works any quadratic for real", () => {
    expect(solveQuadratic("solve x^2 - 7x + 12 = 0")).toMatchObject({ answer: "$x = 3$ or $x = 4$" });
    expect(solveQuadratic("2x^2 + 2x + 5 = 0")).toMatchObject({ answer: expect.stringContaining("No real") });
    expect(solveQuadratic("x^2 - 2x + 1 = 0")).toMatchObject({ answer: "$x = 1$" });
  });
  it("is honest about an unknown topic", () => {
    const b = demoReply("Teach me about the Treaty of Westphalia");
    expect(JSON.stringify(b)).toContain("Demo mode");
  });
  it("gives every pack an explanation with a visual", () => {
    for (const p of PACKS) expect(demoReply(`explain ${p.title}`).some((b) => b.type === "plot" || b.type === "diagram")).toBe(true);
  });
});

describe("tutor service", () => {
  it("Demo mode is labelled and resolves quiz requests through the pipeline", async () => {
    const r = await tutorChat(null, [{ role: "user", text: "quiz me on derivatives" }], []);
    expect(r.mode).toBe("demo");
    expect(r.notice).toContain("Demo mode");
    const quiz = r.blocks.find((b) => b.type === "quiz");
    expect(quiz).toMatchObject({ quality: { mode: "demo" } });
    expect(r.blocks.some((b) => (b as { type: string }).type === "quiz_request")).toBe(false);
  });
  it("explainOnly gives a full explanation and no quiz", async () => {
    const r = await tutorChat(null, [{ role: "user", text: "Explain compound interest with a visual." }], [], { explainOnly: true });
    const types = r.blocks.map((b) => b.type);
    expect(types).toContain("plot");
    expect(types).toContain("text");
    expect(types).not.toContain("quiz");
  });
  it("adapts the level to attempts", async () => {
    const attempts: Attempt[] = Array.from({ length: 5 }, (_, i) => ({ concept: "Derivatives", difficulty: 3, correct: true, at: String(i) }));
    const q = await makeQuiz(null, { topic: "Derivatives", count: 1, attempts });
    expect(q.level).toBe(4);
    expect(q.block?.questions[0].difficulty).toBe(4);
    expect(q.block?.levelReason).toContain("Moved up");
  });
  it("honours harder and an explicit level", async () => {
    expect((await makeQuiz(null, { topic: "Derivatives", count: 1, hint: "something harder" })).level).toBe(3);
    expect((await makeQuiz(null, { topic: "Derivatives", count: 1, hint: "at level 5" })).level).toBe(5);
  });
  it("says so when a demo topic has no questions", async () => {
    const q = await makeQuiz(null, { topic: "The Ottoman Empire", count: 2 });
    expect(q.block).toBeNull();
    expect(q.message).toContain("Demo mode");
  });

  const fakeAi = (reply: (schema: string) => unknown): Ai => ({ call: async <T,>(o: { system: string }) => reply(o.system) as T });

  it("uses the model when present and still runs its questions through the pipeline", async () => {
    const q = good();
    const calls: string[] = [];
    const ai = fakeAi((system) => {
      if (system.startsWith("You write multiple")) return calls.push("write"), { questions: [q] };
      if (system.startsWith("You are a strict")) {
        calls.push("critic");
        return { critiques: [] };
      }
      return { blocks: [{ type: "text", markdown: "hi" }, { type: "quiz_request", topic: "Levers", concept: "Levers", count: 1 }] };
    });
    // Ids are minted per round, so an unmatched critique rejects every time and no bad question ships.
    const r = await tutorChat(ai, [{ role: "user", text: "quiz" }], []);
    expect(r.mode).toBe("model");
    expect(calls).toEqual(["write", "critic", "write", "critic", "write", "critic"]);
    expect(r.blocks.some((b) => b.type === "quiz")).toBe(false);
  });

  it("ships a model question the critic vouches for", async () => {
    let seen: { id: string }[] = [];
    const ai = fakeAi((system) => (system.startsWith("You write") ? { questions: [good()] } : { critiques: [] }));
    const real: Ai = {
      call: async <T,>(o: { system: string; user: string }) => {
        if (!o.system.startsWith("You are a strict")) return ai.call<T>(o as never);
        seen = JSON.parse(o.user).questions;
        return { critiques: seen.map((s) => ({ questionId: s.id, scores: { understanding: 5, distractors: 4, unambiguous: 5, explanations: 5, difficulty: 4 }, note: "" })) } as T;
      },
    };
    const q = await makeQuiz(real, { topic: "Levers", count: 1 });
    expect(q.mode).toBe("model");
    expect(q.block?.quality).toMatchObject({ mode: "model", rounds: 1 });
  });

  it("falls back to labelled Demo mode when the model throws", async () => {
    const ai: Ai = { call: async () => Promise.reject(new Error("401")) };
    const r = await tutorChat(ai, [{ role: "user", text: "explain derivatives" }], []);
    expect(r).toMatchObject({ mode: "demo", notice: expect.stringContaining("did not respond") });
  });
  it("drops an invalid model block and keeps the rest", async () => {
    const ai = fakeAi(() => ({ blocks: [{ type: "text", markdown: "ok" }, { type: "plot", title: "t", domain: [0, 1], curves: [{ label: "y", expr: "evil(x)" }], sliders: [] }] }));
    const r = await tutorChat(ai, [{ role: "user", text: "x" }], []);
    expect(r.blocks).toHaveLength(1);
    expect(r.dropped).toBe(1);
  });
  it("makes flashcards in both modes", async () => {
    expect((await makeFlashcards(null, "derivatives", 2)).block?.cards).toHaveLength(2);
    const ai = fakeAi(() => ({ cards: [{ front: "a", back: "b" }] }));
    expect(await makeFlashcards(ai, "anything", 2)).toMatchObject({ mode: "model" });
  });
  it("grades deterministically with an explanation for every option", () => {
    const g = gradeAnswer(good(), "b", [], "now")!;
    expect(g.correct).toBe(false);
    expect(g.correctOption).toBe("a");
    expect(g.explanations.filter((e) => e.picked).map((e) => e.id)).toEqual(["b"]);
    expect(g.explanations.every((e) => e.explanation.length > 0)).toBe(true);
    expect(g.followups.items[0].label).toBe("Walk me through the one I missed");
  });
  it("grades by option text and rejects an unknown pick", () => {
    expect(gradeAnswer(good(), "It halves it", [], "now")?.correct).toBe(true);
    expect(gradeAnswer(good(), "z", [], "now")).toBeNull();
  });
  it("plans weakest first and respaces review", () => {
    const m = { attempts: [{ concept: "Chain rule", difficulty: 3, correct: false, at: "" }] };
    const plan = buildStudyPlan("Calculus", 10, 20, m);
    expect(plan.focus[0]).toBe("Chain rule");
    const days = plan.schedule.filter((s) => s.concept === "Chain rule").map((s) => s.day);
    expect(days).toEqual([1, 2, 4, 8]);
  });
});

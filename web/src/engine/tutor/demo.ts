// Demo mode (spec 15.5): runs the whole flow with no AI key. It covers the built-in packs, a real
// plotter for any expression and real worked quadratics. It says so when a topic is outside that.
import type { Block, FlashcardsBlock, Question } from "./blocks";
import { compile } from "./expr";
import { PACKS, type Pack } from "./demo-packs";
import type { Critic, Generator } from "./pipeline";
import type { Critique } from "./rubric";

export const DEMO_TOPICS = PACKS.map((p) => p.title);

export function findPack(text: string): Pack | null {
  return PACKS.find((p) => p.match.test(text)) ?? null;
}

const near = (level: number) => (a: Question, b: Question) => Math.abs(a.difficulty - level) - Math.abs(b.difficulty - level) || a.difficulty - b.difficulty;

/** Serves pack questions closest to the target level, skipping any already used. */
export function demoGenerator(pack: Pack): Generator {
  return async (spec) => {
    const avoid = new Set(spec.avoid ?? []);
    return pack.questions.filter((q) => !avoid.has(q.stem)).sort(near(spec.difficulty)).slice(0, spec.count);
  };
}

const RECALL = /^(what is the (definition|name|term)|define|who\b|in what year|when did|which term|what does .{1,30} stand for)/i;

/**
 * The stand-in for the model's self-critique. It can only measure what text shows, so it is stricter on
 * shape than on meaning. The packs were written by hand to the rubric; this keeps them honest.
 */
export const demoCritic: Critic = async (questions, spec) =>
  questions.map((q): Critique => {
    const wrong = q.options.filter((o) => !o.correct);
    const thin = wrong.filter((o) => o.explanation.length < 30).length;
    const shortest = Math.min(...q.options.map((o) => o.explanation.length));
    const gap = Math.abs(q.difficulty - spec.difficulty);
    return {
      questionId: q.id,
      scores: {
        understanding: RECALL.test(q.stem) ? 2 : 5,
        distractors: thin ? 3 : 5,
        unambiguous: /\b(usually|might|perhaps|arguably)\b/i.test(q.stem) ? 3 : 5,
        explanations: shortest < 30 ? 3 : 5,
        difficulty: gap === 0 ? 5 : gap === 1 ? 4 : 3,
      },
      note: RECALL.test(q.stem) ? "Stem asks for recall." : "",
    };
  });

const PLOT = /\b(?:plot|graph|draw|sketch|visuali[sz]e)\s+(?:the\s+)?(?:function\s+)?(?:(?:y|f\(x\))\s*=\s*)?(.+?)\s*[.?!]?$/i;

/** Pulls an expression out of a request, or null when the text is not a formula. */
export function plotRequest(text: string): Block | null {
  const m = PLOT.exec(text.trim());
  if (!m) return null;
  const expr = m[1].replace(/^(?:y|f\(x\))\s*=\s*/i, "").trim();
  try {
    const c = compile(expr);
    const free = c.vars.filter((v) => v !== "x");
    if (!c.vars.includes("x") || free.length > 4 || free.some((v) => v.length > 3)) return null;
    return {
      type: "plot",
      title: `y = ${expr}`,
      variable: "x",
      domain: [-10, 10],
      curves: [{ label: "y", expr }],
      sliders: free.map((name) => ({ name, label: name, min: -5, max: 5, step: 0.1, value: 1 })),
      hint: free.length ? `Drag ${free.join(" and ")} to see what each one controls.` : undefined,
    };
  } catch {
    return null;
  }
}

const QUAD = /(-?\d*\.?\d*)\s*x\s*(?:\^2|²)\s*([+-]\s*\d*\.?\d*)\s*x\s*([+-]\s*\d+\.?\d*)\s*=\s*0/;
const coef = (s: string) => {
  const t = s.replace(/\s/g, "");
  return t === "" || t === "+" ? 1 : t === "-" ? -1 : Number(t);
};
const tex = (n: number) => String(Number(n.toFixed(4)));

/** A real worked solution for any ax^2+bx+c=0 in the text, with the numbers worked out. */
export function solveQuadratic(text: string): Block | null {
  const m = QUAD.exec(text);
  if (!m) return null;
  const [a, b, c] = [coef(m[1]), coef(m[2]), coef(m[3])];
  if (!a || [a, b, c].some(Number.isNaN)) return null;
  const d = b * b - 4 * a * c;
  const steps = [
    {
      ask: "What are a, b and c? Work out the discriminant.",
      work: `$a=${tex(a)},\\ b=${tex(b)},\\ c=${tex(c)}$, so $b^2-4ac = ${tex(d)}$`,
      why: d > 0 ? "It is positive, so expect two real solutions." : d === 0 ? "It is zero, so the two solutions land on one point." : "It is negative, so no real number solves this.",
      check: tex(d),
    },
  ];
  if (d < 0) return { type: "steps", title: "Worked Solution", problem: `Solve $${m[0].replace(/\s/g, "")}$.`, steps, answer: "No real solutions: the parabola never reaches the x-axis." };
  const r1 = (-b + Math.sqrt(d)) / (2 * a);
  const r2 = (-b - Math.sqrt(d)) / (2 * a);
  const [hi, lo] = r1 >= r2 ? [r1, r2] : [r2, r1];
  steps.push({ ask: "Put your values into the quadratic formula. What is the larger solution?", work: `$x = \\dfrac{${tex(-b)} \\pm \\sqrt{${tex(d)}}}{${tex(2 * a)}}$ gives $x = ${tex(hi)}$`, why: "The plus or minus gives one solution each way.", check: tex(hi) });
  if (d > 0) steps.push({ ask: "What is the smaller solution?", work: `$x = ${tex(lo)}$`, why: `Check by substitution: $${tex(a)}(${tex(lo)})^2 + ${tex(b)}(${tex(lo)}) + ${tex(c)} = 0$.`, check: tex(lo) });
  return { type: "steps", title: "Worked Solution", problem: `Solve $${m[0].replace(/\s/g, "")}$.`, steps, answer: d > 0 ? `$x = ${tex(lo)}$ or $x = ${tex(hi)}$` : `$x = ${tex(hi)}$` };
}

export type Intent = "quiz" | "flashcards" | "steps" | "visual" | "explain";

export function intentOf(text: string): Intent {
  if (/\b(quiz|test me|question|practice)\b/i.test(text)) return "quiz";
  if (/\bflash\s?cards?\b/i.test(text)) return "flashcards";
  if (/\b(step by step|steps|solve|worked|walk me through)\b/i.test(text)) return "steps";
  if (/\b(explain|teach me|what is|how does)\b/i.test(text)) return "explain";
  if (/\b(visual|show me|diagram|concept map|map of|picture|graph|chart|plot)\b/i.test(text)) return "visual";
  return "explain";
}

const offTopic = (): Block[] => [
  {
    type: "text",
    markdown: `Demo mode has no AI behind it, so I can't write about that yet. It can plot any formula (try **plot a*sin(b*x)**), work any quadratic, and teach these in full: ${DEMO_TOPICS.join(", ")}.`,
  },
  { type: "followups", items: DEMO_TOPICS.slice(0, 3).map((t) => ({ label: t, prompt: `Explain ${t.toLowerCase()} with a visual` })) },
];

export function demoFlashcards(pack: Pack, count = 12): FlashcardsBlock {
  return { type: "flashcards", title: `${pack.title} Flashcards`, cards: pack.cards.slice(0, count) };
}

function followups(pack: Pack, skip: Intent): Block {
  const items = [
    { i: "quiz" as const, label: "Quiz me", prompt: `Quiz me on ${pack.concept}` },
    { i: "flashcards" as const, label: "Make flashcards", prompt: `Make flashcards for ${pack.concept}` },
    { i: "steps" as const, label: "Show a worked problem", prompt: `Walk me through a worked problem on ${pack.concept}` },
    { i: "visual" as const, label: "Show me a visual", prompt: `Show me a visual of ${pack.concept}` },
  ].filter((x) => x.i !== skip);
  return { type: "followups", items: items.slice(0, 3).map(({ label, prompt }) => ({ label, prompt })) };
}

/** A complete reply with no model. Quiz requests still go through the pipeline in service.ts. */
export function demoReply(text: string, forced?: Intent): Block[] {
  const plot = plotRequest(text);
  if (plot) {
    return [{ type: "text", markdown: "Here it is. Drag along the curve to read values." }, plot];
  }
  const solved = solveQuadratic(text);
  if (solved) return [{ type: "text", markdown: "Try each step before you reveal it." }, solved];

  const pack = findPack(text);
  if (!pack) return offTopic();

  const intent = forced ?? intentOf(text);
  const pick = (t: Block["type"]) => pack.blocks.filter((b) => b.type === t);
  if (intent === "quiz") return [...pick("quiz_request")];
  if (intent === "flashcards") return [demoFlashcards(pack), followups(pack, intent)];
  if (intent === "steps") {
    const steps = pick("steps");
    if (steps.length) return [{ type: "text", markdown: "Try each step before you reveal it." }, ...steps, followups(pack, intent)];
  }
  if (intent === "visual") return [...pick("plot"), ...pick("diagram"), followups(pack, intent)];
  return [{ type: "text", markdown: pack.intro }, ...pack.blocks];
}

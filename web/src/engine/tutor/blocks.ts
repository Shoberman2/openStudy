// The typed block schema a tutor reply is made of (spec 15.1). A reply is an ordered list of blocks;
// nothing the model writes reaches the page until it has passed this file. Zod 4.
import katex from "katex";
import { z } from "zod";
import { checkExpr } from "./expr";

const short = (max: number) => z.string().trim().min(1).max(max);

export const DIFFICULTIES = [1, 2, 3, 4, 5] as const;
export const difficulty = z.number().int().min(1).max(5);

export const optionSchema = z.object({
  id: z.enum(["a", "b", "c", "d"]),
  text: short(200),
  correct: z.boolean(),
  explanation: short(400),
});

export const questionSchema = z.object({
  id: short(60),
  concept: short(80),
  difficulty,
  stem: short(400),
  options: z.array(optionSchema),
  /** Which rubric-level skill it tests: names the thinking, not the fact. */
  skill: z.enum(["apply", "explain", "predict", "compare", "diagnose"]),
});
export type Question = z.infer<typeof questionSchema>;
export type Option = z.infer<typeof optionSchema>;

export const textBlock = z.object({ type: z.literal("text"), markdown: short(4000) });
export const formulaBlock = z.object({ type: z.literal("formula"), latex: short(500), caption: z.string().trim().max(200).optional() });

export const sliderSchema = z
  .object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,11}$/), label: short(40), min: z.number(), max: z.number(), step: z.number().positive(), value: z.number() })
  .refine((s) => s.min < s.max && s.value >= s.min && s.value <= s.max, "slider range");

export const plotBlock = z
  .object({
    type: z.literal("plot"),
    title: short(100),
    /** The variable on the x axis, x unless the topic reads better with t, n and so on. */
    variable: z.string().regex(/^[A-Za-z]$/).default("x"),
    xLabel: z.string().trim().max(40).optional(),
    yLabel: z.string().trim().max(40).optional(),
    domain: z.tuple([z.number(), z.number()]).refine(([a, b]) => a < b, "domain order"),
    range: z.tuple([z.number(), z.number()]).refine(([a, b]) => a < b, "range order").optional(),
    curves: z.array(z.object({ label: short(40), expr: short(200) })).min(1).max(4),
    sliders: z.array(sliderSchema).max(4).default([]),
    /** One line on what to try with the sliders. */
    hint: z.string().trim().max(200).optional(),
  })
  .superRefine((p, ctx) => {
    if (new Set(p.sliders.map((s) => s.name)).size !== p.sliders.length) ctx.addIssue({ code: "custom", message: "duplicate slider" });
    if (p.sliders.some((s) => s.name === p.variable)) ctx.addIssue({ code: "custom", message: "slider shadows the variable" });
    const allowed = [p.variable, ...p.sliders.map((s) => s.name)];
    for (const c of p.curves) {
      const err = checkExpr(c.expr, allowed);
      if (err) ctx.addIssue({ code: "custom", message: `${c.expr}: ${err}` });
    }
  });

export const diagramBlock = z
  .object({
    type: z.literal("diagram"),
    title: short(100),
    nodes: z.array(z.object({ id: short(30), label: short(50), detail: z.string().trim().max(240).optional() })).min(2).max(14),
    edges: z.array(z.object({ from: short(30), to: short(30), label: z.string().trim().max(30).optional() })).max(24),
  })
  .superRefine((d, ctx) => {
    const ids = new Set(d.nodes.map((n) => n.id));
    if (ids.size !== d.nodes.length) ctx.addIssue({ code: "custom", message: "duplicate node id" });
    for (const e of d.edges) if (!ids.has(e.from) || !ids.has(e.to)) ctx.addIssue({ code: "custom", message: `edge to unknown node ${e.from}/${e.to}` });
  });

export const stepsBlock = z.object({
  type: z.literal("steps"),
  title: short(100),
  problem: short(600),
  steps: z
    .array(
      z.object({
        /** Asked before the step is shown so the learner tries first. */
        ask: short(200),
        work: short(600),
        why: short(400),
        /** Optional number or expression the learner's attempt is checked against. */
        check: z.string().trim().max(40).optional(),
      }),
    )
    .min(1)
    .max(10),
  answer: short(300),
});

export const flashcardsBlock = z.object({
  type: z.literal("flashcards"),
  title: short(100),
  cards: z.array(z.object({ front: short(240), back: short(400) })).min(1).max(30),
});

export const qualityReport = z.object({
  mode: z.enum(["model", "demo"]),
  rounds: z.number().int(),
  generated: z.number().int(),
  rejected: z.number().int(),
  checks: z.number().int(),
  /** Mean rubric score out of 5 across the questions that shipped. */
  score: z.number(),
});
export type QualityReport = z.infer<typeof qualityReport>;

export const quizBlock = z.object({
  type: z.literal("quiz"),
  title: short(100),
  concept: short(80),
  questions: z.array(questionSchema).min(1).max(12),
  quality: qualityReport.optional(),
  /** Why this difficulty, in words the learner sees. */
  levelReason: z.string().trim().max(200).optional(),
});

/** A request for questions. The server turns it into a quiz block through the quality pipeline. */
export const quizRequestBlock = z.object({
  type: z.literal("quiz_request"),
  topic: short(120),
  concept: short(80),
  count: z.number().int().min(1).max(8).default(3),
});

export const followupsBlock = z.object({
  type: z.literal("followups"),
  items: z.array(z.object({ label: short(60), prompt: short(300) })).min(1).max(4),
});

export const blockSchema = z.union([textBlock, formulaBlock, plotBlock, diagramBlock, stepsBlock, flashcardsBlock, quizBlock, quizRequestBlock, followupsBlock]);
export type Block = z.infer<typeof blockSchema>;
export type PlotBlock = z.infer<typeof plotBlock>;
export type DiagramBlock = z.infer<typeof diagramBlock>;
export type StepsBlock = z.infer<typeof stepsBlock>;
export type FlashcardsBlock = z.infer<typeof flashcardsBlock>;
export type QuizBlock = z.infer<typeof quizBlock>;
export type FollowupsBlock = z.infer<typeof followupsBlock>;
export type RenderBlock = Exclude<Block, { type: "quiz_request" }>;

export function latexError(latex: string): string | null {
  try {
    katex.renderToString(latex, { throwOnError: true, trust: false, strict: "ignore" });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "bad latex";
  }
}

export type Dropped = { type: string; reason: string };

/**
 * Validates untrusted blocks. A bad block never reaches the page: bad LaTeX in a formula falls back to
 * plain text so the idea survives, anything else is dropped and reported.
 */
export function validateBlocks(raw: unknown): { blocks: Block[]; dropped: Dropped[] } {
  const blocks: Block[] = [];
  const dropped: Dropped[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = blockSchema.safeParse(item);
    const type = String((item as { type?: unknown } | null)?.type ?? "unknown");
    if (!r.success) {
      dropped.push({ type, reason: r.error.issues[0]?.message ?? "invalid" });
      continue;
    }
    if (r.data.type === "formula" && latexError(r.data.latex)) {
      dropped.push({ type, reason: "latex did not parse" });
      blocks.push({ type: "text", markdown: r.data.latex });
      continue;
    }
    blocks.push(r.data);
  }
  return { blocks, dropped };
}

/** The JSON Schema sent to the model. Bounds live in Zod above, which runs on every reply. */
const s = { type: "string" };
const n = { type: "number" };
const obj = (properties: Record<string, unknown>, optional: string[] = []) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
  properties,
});
const lit = (v: string) => ({ type: "string", enum: [v] });
const arr = (items: unknown) => ({ type: "array", items });

export const replyJsonSchema = obj({
  blocks: arr({
    anyOf: [
      obj({ type: lit("text"), markdown: s }),
      obj({ type: lit("formula"), latex: s, caption: s }, ["caption"]),
      obj(
        {
          type: lit("plot"),
          title: s,
          variable: s,
          xLabel: s,
          yLabel: s,
          domain: arr(n),
          range: arr(n),
          curves: arr(obj({ label: s, expr: s })),
          sliders: arr(obj({ name: s, label: s, min: n, max: n, step: n, value: n })),
          hint: s,
        },
        ["xLabel", "yLabel", "range", "hint"],
      ),
      obj({
        type: lit("diagram"),
        title: s,
        nodes: arr(obj({ id: s, label: s, detail: s }, ["detail"])),
        edges: arr(obj({ from: s, to: s, label: s }, ["label"])),
      }),
      obj({
        type: lit("steps"),
        title: s,
        problem: s,
        steps: arr(obj({ ask: s, work: s, why: s, check: s }, ["check"])),
        answer: s,
      }),
      obj({ type: lit("flashcards"), title: s, cards: arr(obj({ front: s, back: s })) }),
      obj({ type: lit("quiz_request"), topic: s, concept: s, count: n }),
      obj({ type: lit("followups"), items: arr(obj({ label: s, prompt: s })) }),
    ],
  }),
});

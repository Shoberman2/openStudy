// The question quality rubric (spec 15.3, docs/question-quality.md). One source of truth: the model's
// writing prompt, the self-critique and the demo critic all read this list.

export type CriterionId = "understanding" | "distractors" | "unambiguous" | "explanations" | "difficulty";

export type Criterion = { id: CriterionId; name: string; weight: number; pass: string };

export const RUBRIC: Criterion[] = [
  {
    id: "understanding",
    name: "Tests understanding, not recall",
    weight: 3,
    pass: "Answering takes applying, predicting, comparing or explaining. Someone who memorised a definition without understanding it would not reliably get it right.",
  },
  {
    id: "distractors",
    name: "Plausible distractors from real misconceptions",
    weight: 3,
    pass: "Every wrong option is a mistake real learners make, and its explanation names that mistake. No filler or joke options.",
  },
  {
    id: "unambiguous",
    name: "Exactly one unambiguous answer",
    weight: 3,
    pass: "An expert would pick the same single option without needing to assume anything the stem leaves out.",
  },
  {
    id: "explanations",
    name: "An explanation for every option",
    weight: 2,
    pass: "Each option says why it is right or wrong in terms of the idea, so a learner who picked it knows what to fix. Not just 'this is incorrect'.",
  },
  {
    id: "difficulty",
    name: "Difficulty matches the target level",
    weight: 2,
    pass: "The item fits the requested level on the 1 to 5 scale in DIFFICULTY_LEVELS.",
  },
];

export const DIFFICULTY_LEVELS: Record<number, string> = {
  1: "One idea, one step, in a plain setting close to how it was taught.",
  2: "One idea applied to a new but simple example.",
  3: "Two steps, or one idea in an unfamiliar setting.",
  4: "Combines two ideas, or asks the learner to predict what changes when a condition changes.",
  5: "Diagnoses a flawed argument or reasons about an edge case, where the obvious approach fails.",
};

/** Every criterion must reach this on the 1 to 5 scale, and the weighted mean must reach PASS_MEAN. */
export const PASS_FLOOR = 3;
export const PASS_MEAN = 4;

export type Critique = { questionId: string; scores: Record<CriterionId, number>; note: string };

export function weightedMean(scores: Record<CriterionId, number>): number {
  const total = RUBRIC.reduce((a, c) => a + c.weight, 0);
  return RUBRIC.reduce((a, c) => a + c.weight * (scores[c.id] ?? 0), 0) / total;
}

export function critiquePasses(c: Critique): boolean {
  return RUBRIC.every((r) => (c.scores[r.id] ?? 0) >= PASS_FLOOR) && weightedMean(c.scores) >= PASS_MEAN;
}

export function rubricText(): string {
  const items = RUBRIC.map((c) => `- ${c.id} (${c.name}): ${c.pass}`).join("\n");
  const levels = Object.entries(DIFFICULTY_LEVELS)
    .map(([k, v]) => `${k}. ${v}`)
    .join("\n");
  return `Rubric:\n${items}\n\nDifficulty levels:\n${levels}`;
}

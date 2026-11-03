// generate -> deterministic validator -> self-critique against the rubric -> regenerate what failed
// (spec 15.3). The generator and critic are injected, so the model, the demo and tests share this one
// path. A question that never passes is dropped: it is never shown with a warning instead.
import type { Question, QualityReport } from "./blocks";
import { critiquePasses, weightedMean, type Critique } from "./rubric";
import { CHECK_COUNT, duplicateStems, validateQuestion, type Issue } from "./validator";

export type QuizSpec = { topic: string; concept: string; count: number; difficulty: number; avoid?: string[] };

/** What the generator hears about a failed attempt so the rewrite can fix it. */
export type Feedback = { stem: string; problems: string[] };

export type Generator = (spec: QuizSpec, feedback: Feedback[]) => Promise<unknown[]>;
export type Critic = (questions: Question[], spec: QuizSpec) => Promise<Critique[]>;

export type Rejection = { stem: string; stage: "validator" | "critique"; problems: string[]; round: number };

export type PipelineResult = { questions: Question[]; report: QualityReport; rejections: Rejection[] };

export const MAX_ROUNDS = 3;

const stemOf = (q: unknown) => String((q as { stem?: unknown } | null)?.stem ?? "(no stem)");
const issueText = (i: Issue) => `${i.code}: ${i.detail}`;

export async function runPipeline(spec: QuizSpec, generate: Generator, critique: Critic, mode: "model" | "demo", maxRounds = MAX_ROUNDS): Promise<PipelineResult> {
  const kept: { q: Question; score: number }[] = [];
  const rejections: Rejection[] = [];
  let feedback: Feedback[] = [];
  let generated = 0;
  let rounds = 0;

  while (kept.length < spec.count && rounds < maxRounds) {
    rounds++;
    const need = spec.count - kept.length;
    const raw = await generate({ ...spec, count: need, avoid: [...(spec.avoid ?? []), ...kept.map((k) => k.q.stem)] }, feedback);
    generated += raw.length;
    feedback = [];

    const fine: Question[] = [];
    for (const item of raw) {
      const issues = validateQuestion(item);
      if (issues.length) {
        const problems = issues.map(issueText);
        rejections.push({ stem: stemOf(item), stage: "validator", problems, round: rounds });
        feedback.push({ stem: stemOf(item), problems });
        continue;
      }
      const q = item as Question;
      if (duplicateStems([...kept.map((k) => k.q), ...fine, q]).length) {
        rejections.push({ stem: q.stem, stage: "validator", problems: ["duplicate: same stem as another question in the set"], round: rounds });
        continue;
      }
      fine.push(q);
    }
    if (!fine.length) continue;

    const notes = new Map((await critique(fine, spec)).map((c) => [c.questionId, c]));
    for (const q of fine) {
      const c = notes.get(q.id);
      // No critique means nobody vouched for it, so it does not pass.
      if (c && critiquePasses(c)) {
        kept.push({ q, score: weightedMean(c.scores) });
        continue;
      }
      const problems = c ? [c.note || "scored below the rubric bar"] : ["no critique returned"];
      rejections.push({ stem: q.stem, stage: "critique", problems, round: rounds });
      feedback.push({ stem: q.stem, problems });
    }
  }

  const questions = kept.slice(0, spec.count).map((k) => k.q);
  const shipped = kept.slice(0, spec.count);
  return {
    questions,
    rejections,
    report: {
      mode,
      rounds,
      generated,
      rejected: rejections.length,
      checks: CHECK_COUNT,
      score: shipped.length ? Math.round((shipped.reduce((a, k) => a + k.score, 0) / shipped.length) * 10) / 10 : 0,
    },
  };
}

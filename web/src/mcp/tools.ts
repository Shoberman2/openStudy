// The OpenStudy study tools (spec 15.7), registered on any McpServer: the HTTP route and stdio share
// this. Separate from /api/mcp, which is the owner's analytics server and stays behind its token.
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { readAttempts } from "@/engine/tutor/adaptive";
import { questionSchema } from "@/engine/tutor/blocks";
import { buildStudyPlan } from "@/engine/tutor/plan";
import { DEMO_NOTICE, gradeAnswer, makeFlashcards, makeQuiz, tutorChat, type Ai, type Mode } from "@/engine/tutor/service";
import { WIDGET_MIME, WIDGETS, widgetHtml, type WidgetKind } from "./widgets";

export const SERVER_INFO = { name: "openstudy-study", version: "1.0.0" };

export const INSTRUCTIONS =
  "OpenStudy teaches with interactive visuals and quality-checked questions. Prefer these tools over writing quizzes or flashcards yourself. Let the learner answer before revealing anything: never state the correct option of a quiz until grade_answer has run.";

const attempt = z.object({ concept: z.string().max(80), difficulty: z.number().int().min(1).max(5), correct: z.boolean(), at: z.string().max(40).optional() });
const attempts = z.array(attempt).max(200).optional().describe("The learner's earlier answers, which set the difficulty. Pass back the attempts from the last grade_answer.");

const widgetMeta = (kind: WidgetKind, invoking: string, invoked: string) => ({
  ui: { resourceUri: WIDGETS[kind].uri },
  "openai/outputTemplate": WIDGETS[kind].uri,
  "openai/toolInvocation/invoking": invoking,
  "openai/toolInvocation/invoked": invoked,
  "openai/widgetAccessible": true,
});

const notice = (mode: Mode) => (mode === "demo" ? DEMO_NOTICE : undefined);
const reply = (text: string, structuredContent?: Record<string, unknown>) => ({ content: [{ type: "text" as const, text }], ...(structuredContent ? { structuredContent } : {}) });

/** `ai` null is Demo mode. A question from any tool here went through runPipeline. */
export function registerStudyTools(server: McpServer, ai: Ai | null): void {
  for (const kind of Object.keys(WIDGETS) as WidgetKind[]) {
    const w = WIDGETS[kind];
    server.registerResource(kind, w.uri, { title: w.title, description: w.description, mimeType: WIDGET_MIME }, async () => ({
      contents: [
        {
          uri: w.uri,
          mimeType: WIDGET_MIME,
          text: widgetHtml(kind),
          // No outside origins at all: everything is inline.
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true }, "openai/widgetDescription": w.description, "openai/widgetPrefersBorder": true },
        },
      ],
    }));
  }

  server.registerTool(
    "generate_quiz",
    {
      title: "Generate a quiz",
      description: "Interactive multiple choice quiz on any topic. Each question passes deterministic checks and a rubric review, has one answer, plausible wrong answers and an explanation for every option. Difficulty adapts to attempts.",
      inputSchema: z.object({
        topic: z.string().min(1).max(200).describe("What to quiz on"),
        count: z.number().int().min(1).max(8).default(3),
        difficulty: z.number().int().min(1).max(5).optional().describe("1 to 5. Leave out to adapt to attempts."),
        attempts,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: widgetMeta("quiz", "Writing and checking questions", "Quiz ready"),
    },
    async ({ topic, count, difficulty, attempts }) => {
      const q = await makeQuiz(ai, { topic, count, difficulty, attempts: readAttempts(attempts) });
      if (!q.block) return reply(q.message ?? "No questions this time.");
      return reply(`Quiz ready: ${q.block.questions.length} question${q.block.questions.length === 1 ? "" : "s"} on ${q.block.concept} at level ${q.level} of 5. Mode: ${q.mode}. Do not reveal answers: let the learner choose, then call grade_answer.`, {
        kind: "quiz",
        mode: q.mode,
        notice: notice(q.mode),
        quiz: q.block,
        level: q.level,
        quality: q.block.quality,
        rejected: q.result?.rejections.map((r) => ({ stage: r.stage, problems: r.problems })),
        attempts: readAttempts(attempts),
      });
    },
  );

  server.registerTool(
    "explain_concept",
    {
      title: "Explain a concept",
      description: "Explains a concept with interactive blocks: formulas, graphs with sliders, concept maps and step by step solutions the learner tries first.",
      inputSchema: z.object({ concept: z.string().min(1).max(300).describe("The concept or question to explain"), attempts }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: widgetMeta("explanation", "Building an explanation", "Explanation ready"),
    },
    async ({ concept, attempts }) => {
      const r = await tutorChat(ai, [{ role: "user", text: `Explain ${concept} with a visual.` }], attempts, { explainOnly: true });
      const blocks = r.blocks;
      const text = blocks.flatMap((b) => (b.type === "text" ? [b.markdown] : [])).join("\n\n");
      return reply(text || `Explanation of ${concept} shown.`, { kind: "explanation", mode: r.mode, notice: r.notice, blocks });
    },
  );

  server.registerTool(
    "make_flashcards",
    {
      title: "Make flashcards",
      description: "An interactive flashcard deck: flip, mark what you know, review what you missed.",
      inputSchema: z.object({ topic: z.string().min(1).max(200), count: z.number().int().min(1).max(30).default(10) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: widgetMeta("flashcards", "Making flashcards", "Flashcards ready"),
    },
    async ({ topic, count }) => {
      const f = await makeFlashcards(ai, topic, count);
      if (!f.block) return reply(f.message ?? "No flashcards this time.");
      return reply(`${f.block.cards.length} flashcard${f.block.cards.length === 1 ? "" : "s"} on ${topic}. Mode: ${f.mode}.`, { kind: "flashcards", mode: f.mode, notice: notice(f.mode), flashcards: f.block });
    },
  );

  server.registerTool(
    "get_study_plan",
    {
      title: "Get a study plan",
      description: "A day by day plan built on spaced retrieval, weakest concepts first, at a level taken from the learner's attempts.",
      inputSchema: z.object({
        topic: z.string().min(1).max(200),
        days: z.number().int().min(1).max(60).default(14),
        minutesPerDay: z.number().int().min(5).max(240).default(20),
        concepts: z.array(z.string().min(1).max(80)).max(10).optional().describe("Sub-topics to schedule, if known"),
        attempts,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ topic, days, minutesPerDay, concepts, attempts }) => {
      const plan = buildStudyPlan(topic, days, minutesPerDay, { attempts: readAttempts(attempts) }, concepts);
      const lines = plan.schedule.map((s) => `Day ${s.day}: ${s.concept}, level ${s.level}. ${s.activity}.`);
      return reply(lines.join("\n"), { kind: "plan", plan });
    },
  );

  server.registerTool(
    "grade_answer",
    {
      title: "Grade an answer",
      description: "Grades one quiz answer. Returns whether it was right, an explanation for every option, updated attempts and the next difficulty with the reason.",
      inputSchema: z.object({
        question: questionSchema.describe("The question exactly as generate_quiz returned it"),
        selected: z.string().min(1).max(200).describe("The option id (a to d) or its text"),
        attempts,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ question, selected, attempts }) => {
      const g = gradeAnswer(question, selected, attempts, new Date().toISOString());
      if (!g) return { ...reply(`"${selected}" is not one of the options.`), isError: true };
      const lines = g.explanations.map((e) => `${e.id}. ${e.text}: ${e.explanation}`);
      return reply(`${g.correct ? "Correct" : `Not quite: the answer is ${g.correctOption}`}.\n${lines.join("\n")}\n${g.next.reason}`, { kind: "grade", ...g });
    },
  );
}

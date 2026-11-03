// Calls every OpenStudy study tool over a real transport and prints what came back.
//   npm run -s mcp:exercise -- http http://localhost:3000/mcp
//   npm run -s mcp:exercise -- stdio
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

type Result = { content?: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const [mode = "stdio", url = "http://localhost:3000/mcp"] = process.argv.slice(2);
const client = new Client({ name: "openstudy-exercise", version: "1.0.0" });
const transport =
  mode === "http"
    ? new StreamableHTTPClientTransport(new URL(url))
    : new StdioClientTransport({ command: "npm", args: ["--prefix", process.cwd(), "run", "-s", "mcp:stdio"], stderr: "inherit" });

let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures++;
};
const head = (t: string) => console.log(`\n== ${t}`);
const call = async (name: string, args: Record<string, unknown>) => {
  head(`${name} ${JSON.stringify(args).slice(0, 110)}`);
  const r = (await client.callTool({ name, arguments: args })) as Result;
  const text = r.content?.find((c) => c.type === "text")?.text ?? "";
  console.log(text.split("\n").slice(0, 8).join("\n"));
  check(!r.isError, "no error");
  return r;
};

await client.connect(transport);
console.log(`Transport: ${mode}${mode === "http" ? ` ${url}` : ""}`);
console.log(`Server: ${JSON.stringify(client.getServerVersion())}`);

head("tools/list");
const { tools } = await client.listTools();
for (const t of tools) console.log(`  ${t.name}${t._meta ? `  ui=${JSON.stringify((t._meta as { ui?: unknown }).ui)} outputTemplate=${(t._meta as Record<string, unknown>)["openai/outputTemplate"]}` : ""}`);
check(["explain_concept", "generate_quiz", "get_study_plan", "grade_answer", "make_flashcards"].every((n) => tools.some((t) => t.name === n)), "all five tools listed");

head("resources/list and read");
const { resources } = await client.listResources();
for (const r of resources) {
  const read = await client.readResource({ uri: r.uri });
  const c = read.contents[0] as { mimeType?: string; text?: string };
  console.log(`  ${r.uri}  ${c.mimeType}  ${c.text?.length} chars`);
  check(c.mimeType === "text/html;profile=mcp-app" && !!c.text?.startsWith("<!doctype html>"), `${r.name} is an MCP App resource`);
}

const quiz = await call("generate_quiz", { topic: "derivatives", count: 3 });
const q = quiz.structuredContent as { mode: string; quality: unknown; quiz: { questions: { id: string; stem: string; difficulty: number; options: { id: string; text: string; correct: boolean }[] }[] } };
console.log(`  mode=${q.mode} quality=${JSON.stringify(q.quality)}`);
check(q.quiz.questions.length === 3, "3 questions");
check(q.quiz.questions.every((x) => x.options.length === 4 && x.options.filter((o) => o.correct).length === 1), "4 options, one correct");

const first = q.quiz.questions[0];
const wrong = first.options.find((o) => !o.correct)!;
const graded = await call("grade_answer", { question: first, selected: wrong.id, attempts: [] });
const g = graded.structuredContent as { correct: boolean; attempts: unknown[]; explanations: unknown[]; next: unknown };
check(g.correct === false && g.explanations.length === 4, "wrong answer graded, 4 explanations");
console.log(`  next=${JSON.stringify(g.next)}`);

const hot = Array.from({ length: 5 }, (_, i) => ({ concept: "Derivatives", difficulty: 3, correct: true, at: String(i) }));
const adapted = await call("generate_quiz", { topic: "derivatives", count: 1, attempts: hot });
const a = adapted.structuredContent as { level: number };
check(a.level === 4, "five right at level 3 moves the next quiz to level 4");

const bad = (await client.callTool({ name: "grade_answer", arguments: { question: first, selected: "z" } })) as Result;
head("grade_answer with a bad option");
check(bad.isError === true, "reported as a tool error");

const explain = await call("explain_concept", { concept: "compound interest" });
const e = explain.structuredContent as { blocks: { type: string }[] };
console.log(`  blocks: ${e.blocks.map((b) => b.type).join(", ")}`);
check(e.blocks.some((b) => b.type === "plot"), "includes an interactive plot");

const cards = await call("make_flashcards", { topic: "photosynthesis", count: 3 });
check((cards.structuredContent as { flashcards: { cards: unknown[] } }).flashcards.cards.length === 3, "3 cards");

const plan = await call("get_study_plan", { topic: "Calculus", days: 7, minutesPerDay: 25, concepts: ["Derivatives"], attempts: [{ concept: "Chain rule", difficulty: 3, correct: false }] });
check(((plan.structuredContent as { plan: { focus: string[] } }).plan.focus[0]) === "Chain rule", "weakest concept comes first");

const off = await call("generate_quiz", { topic: "The Ottoman Empire", count: 2 });
check(!off.structuredContent, "Demo mode says it has no questions rather than inventing them");

await client.close();
console.log(`\n${failures ? `${failures} FAILED` : "ALL PASSED"}`);
process.exit(failures ? 1 : 0);

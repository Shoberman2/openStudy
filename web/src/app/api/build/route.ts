import { isVerbatim } from "@/engine/ask";
import { aiEnabled, aiFailed, noAi, structuredCall } from "@/lib/server/claude";

export const dynamic = "force-dynamic";

type BuildBody = {
  project: { title: string; author?: string };
  pages: { id: string; text: string }[];
  profile?: { goals?: string[]; practice?: string[] };
  wantQuotes: boolean;
};

type CardOut = { pageId: string; statement: string; cloze: string; question: string; answer: string; distractors: string[]; falseStatement: string };
type LessonOut = { title: string; summary: string; cards: CardOut[] };
type BuildOut = { lessons: LessonOut[]; quotes: { pageId: string; text: string; attribution: string }[] };

const str = { type: "string" };
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["lessons", "quotes"],
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "cards"],
        properties: {
          title: { type: "string", description: "Short theme title, 1-4 words, Title Case." },
          summary: { type: "string", description: "One plain sentence, max 120 characters." },
          cards: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["pageId", "statement", "cloze", "question", "answer", "distractors", "falseStatement"],
              properties: {
                pageId: str,
                statement: { type: "string", description: "One self-contained true sentence from the pages." },
                cloze: { type: "string", description: "Key term; an exact substring of statement." },
                question: { type: "string", description: "Direct recall question." },
                answer: { type: "string", description: "Short answer, 1-6 words." },
                distractors: { type: "array", items: str, description: "Exactly 3 wrong but plausible short answers." },
                falseStatement: { type: "string", description: "statement with one detail changed so it is false." },
              },
            },
          },
        },
      },
    },
    quotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pageId", "text", "attribution"],
        properties: { pageId: str, text: { type: "string", description: "Exact wording copied from the page." }, attribution: str },
      },
    },
  },
};

function system(wantQuotes: boolean, goals: string[]) {
  return `You turn saved book pages into a study path, like Duolingo lessons.
Make 2-6 theme lessons for the project, each with up to 14 fact cards grounded only in the given pages.
Learner goals: ${goals.join(", ") || "ideas"}.
${wantQuotes ? "Also pick up to 20 lines worth memorizing word for word. Quote text must be copied exactly from the pages." : "Return an empty quotes array."}
Never use em dashes. Keep wording plain.`;
}

const CHUNK = 60;

export async function POST(req: Request) {
  if (!aiEnabled()) return noAi();
  let body: BuildBody;
  try {
    body = (await req.json()) as BuildBody;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const pages = (body.pages ?? []).map((p) => ({ id: String(p.id), text: String(p.text ?? "") }));
  if (!pages.length) return Response.json({ lessons: [], quotes: [] });
  const project = { title: String(body.project?.title ?? "Untitled"), author: body.project?.author };
  try {
    const chunks: (typeof pages)[] = [];
    for (let i = 0; i < pages.length; i += CHUNK) chunks.push(pages.slice(i, i + CHUNK));
    const results = await Promise.all(
      chunks.map((chunk) =>
        structuredCall<BuildOut>({
          system: system(!!body.wantQuotes, body.profile?.goals ?? []),
          user: JSON.stringify({ project, pages: chunk }),
          schema,
        }),
      ),
    );
    // Merge lessons by title across chunks.
    const byTitle = new Map<string, LessonOut>();
    for (const r of results)
      for (const l of r.lessons) {
        const k = l.title.trim().toLowerCase();
        const cur = byTitle.get(k);
        if (cur) cur.cards.push(...l.cards);
        else byTitle.set(k, { ...l, cards: [...l.cards] });
      }
    const ids = new Set(pages.map((p) => p.id));
    const lessons = [...byTitle.values()].map((l) => ({
      title: l.title,
      summary: l.summary.slice(0, 120),
      cards: l.cards
        .filter((c) => c.statement.toLowerCase().includes(c.cloze.toLowerCase()))
        .slice(0, 14)
        .map((c) => ({ ...c, pageId: ids.has(c.pageId) ? c.pageId : undefined, distractors: c.distractors.slice(0, 3) })),
    }));
    // Spec 10.9: a quote must be word for word in one of the pages; it cites the page that holds it.
    const quotes = body.wantQuotes
      ? results
          .flatMap((r) => r.quotes)
          .map((q) => ({ q, page: pages.find((p) => isVerbatim(q.text, p.text)) }))
          .filter((x) => x.page)
          .slice(0, 20)
          .map(({ q, page }) => ({ pageId: page!.id, text: q.text, attribution: q.attribution || project.author }))
      : [];
    return Response.json({ lessons, quotes });
  } catch (e) {
    return aiFailed(e);
  }
}

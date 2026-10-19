import { aiEnabled, aiFailed, noAi, structuredCall } from "@/lib/server/claude";

export const dynamic = "force-dynamic";

type SortBody = { pages: { id: string; header?: string; text: string }[] };
type SortOut = { groups: { title: string; author: string; pageIds: string[] }[] };

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["groups"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "author", "pageIds"],
        properties: {
          title: { type: "string", description: "Book title (or the best guess). 'Unsorted' if unknown." },
          author: { type: "string", description: "Author name, or empty string if unknown." },
          pageIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const SYSTEM = `You sort saved book pages (OCR'd Apple Books screenshots and Notes excerpts) into books.
Group pages that come from the same book. Headers are usually the book title or a chapter title.
Use the real book title and author when you can recognize them. Every page id must appear in exactly one group.`;

export async function POST(req: Request) {
  if (!aiEnabled()) return noAi();
  let body: SortBody;
  try {
    body = (await req.json()) as SortBody;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const pages = (body.pages ?? []).slice(0, 400).map((p) => ({ id: String(p.id), header: p.header ?? "", text: String(p.text ?? "").slice(0, 700) }));
  if (!pages.length) return Response.json({ groups: [] });
  try {
    const out = await structuredCall<SortOut>({ system: SYSTEM, user: JSON.stringify({ pages }), schema });
    const known = new Set(pages.map((p) => p.id));
    const seen = new Set<string>();
    const groups = out.groups
      .map((g) => ({
        title: g.title.trim() || "Unsorted",
        author: g.author.trim() || undefined,
        pageIds: g.pageIds.filter((id) => known.has(id) && !seen.has(id) && (seen.add(id), true)),
      }))
      .filter((g) => g.pageIds.length);
    const missing = pages.map((p) => p.id).filter((id) => !seen.has(id));
    if (missing.length) groups.push({ title: "Unsorted", author: undefined, pageIds: missing });
    return Response.json({ groups });
  } catch (e) {
    return aiFailed(e);
  }
}

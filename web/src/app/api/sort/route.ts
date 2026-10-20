import { aiEnabled, aiFailed, noAi, structuredCall } from "@/lib/server/claude";

export const dynamic = "force-dynamic";

type SortBody = { pages: { id: string; header?: string; source?: string; folder?: string; text: string }[]; categories?: string[] };
type SortOut = { groups: { title: string; author: string; category: string; pageIds: string[] }[] };

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
        required: ["title", "author", "category", "pageIds"],
        properties: {
          title: { type: "string", description: "Book title, class name or topic (or the best guess). 'Unsorted' if unknown." },
          author: { type: "string", description: "Author name, or empty string if unknown." },
          category: { type: "string", description: "Subject shelf, e.g. 'Biology'. Reuse one of the given categories when it fits." },
          pageIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const SYSTEM = `You sort someone's saved study material (OCR'd Apple Books screenshots, photos of notes, Apple Notes, slides, docs) into projects.
A project is one book, one class, or one topic. Group pages that come from the same book or class; group loose notes by topic.
Headers are usually the book title or a chapter title. "source" is the file or note title, "folder" the Notes folder.
Use the real book title and author when you can recognize them. Give each project a short subject category, reusing one of the given categories when it fits.
Every page id must appear in exactly one group.`;

export async function POST(req: Request) {
  if (!aiEnabled()) return noAi();
  let body: SortBody;
  try {
    body = (await req.json()) as SortBody;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const pages = (body.pages ?? []).slice(0, 400).map((p) => ({
    id: String(p.id),
    header: p.header ?? "",
    source: p.source ?? "",
    folder: p.folder ?? "",
    text: String(p.text ?? "").slice(0, 700),
  }));
  const categories = (body.categories ?? []).filter((c) => typeof c === "string").slice(0, 60);
  if (!pages.length) return Response.json({ groups: [] });
  try {
    const out = await structuredCall<SortOut>({ system: SYSTEM, user: JSON.stringify({ categories, pages }), schema });
    const known = new Set(pages.map((p) => p.id));
    const seen = new Set<string>();
    const groups = out.groups
      .map((g) => ({
        title: g.title.trim() || "Unsorted",
        author: g.author.trim() || undefined,
        category: g.category.trim() || undefined,
        pageIds: g.pageIds.filter((id) => known.has(id) && !seen.has(id) && (seen.add(id), true)),
      }))
      .filter((g) => g.pageIds.length);
    const missing = pages.map((p) => p.id).filter((id) => !seen.has(id));
    if (missing.length) groups.push({ title: "Unsorted", author: undefined, category: undefined, pageIds: missing });
    return Response.json({ groups });
  } catch (e) {
    return aiFailed(e);
  }
}

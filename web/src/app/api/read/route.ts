import { aiClient, aiEnabled, aiFailed, modelParams, noAi, RefusalError } from "@/lib/server/claude";

export const dynamic = "force-dynamic";

type ReadBody = { image?: string; mediaType?: string };
type ReadOut = { text: string; heading: string };

const MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type Media = (typeof MEDIA)[number];

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "heading"],
  properties: {
    text: { type: "string", description: "All readable text in reading order. One line per bullet or line of handwriting. Describe diagrams briefly in words." },
    heading: { type: "string", description: "The title or topic written at the top, or empty string if none." },
  },
};

const SYSTEM = `You transcribe study material from images: book pages, slides, handwritten notes, whiteboards.
Copy the words exactly as written, fixing only obvious OCR-style breaks. Keep list structure as separate lines.
Leave out phone status bars, page numbers and UI chrome. Never use em dashes.`;


export async function POST(req: Request) {
  if (!aiEnabled()) return noAi();
  let body: ReadBody;
  try {
    body = (await req.json()) as ReadBody;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const mediaType = (MEDIA.includes(body.mediaType as Media) ? body.mediaType : "image/jpeg") as Media;
  if (!body.image || body.image.length > 8_000_000) return Response.json({ error: "bad_request" }, { status: 400 });
  try {
    const msg = await aiClient()
      .beta.messages.stream({
        ...modelParams(),
        max_tokens: 16000,
        output_config: { effort: "low", format: { type: "json_schema", schema } },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: body.image } },
              { type: "text", text: "Transcribe this image." },
            ],
          },
        ],
      })
      .finalMessage();
    if (msg.stop_reason === "refusal") throw new RefusalError("refused");
    const out = JSON.parse(msg.content.map((b) => (b.type === "text" ? b.text : "")).join("")) as ReadOut;
    return Response.json({ text: out.text ?? "", heading: out.heading || undefined });
  } catch (e) {
    return aiFailed(e);
  }
}

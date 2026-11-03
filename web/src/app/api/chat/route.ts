// The visual chat (spec 15). The model's blocks are validated in the tutor service; with no key this
// answers in Demo mode rather than failing, so the flow works on any deployment.
import { tutorChat, type ChatMessage } from "@/engine/tutor/service";
import { tutorAi } from "@/lib/server/tutor-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  let body: { messages?: unknown; attempts?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const messages: ChatMessage[] = (Array.isArray(body.messages) ? body.messages : []).slice(-12).flatMap((m) => {
    const o = (m ?? {}) as { role?: unknown; text?: unknown };
    const text = String(o.text ?? "").trim().slice(0, 2000);
    return text && (o.role === "user" || o.role === "assistant") ? [{ role: o.role, text }] : [];
  });
  if (!messages.some((m) => m.role === "user")) return Response.json({ error: "bad_request" }, { status: 400 });
  return Response.json(await tutorChat(tutorAi(), messages, body.attempts));
}

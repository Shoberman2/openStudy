import { localNotesEnabled, NotesPermissionError, readAppleNotes } from "@/lib/server/notes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!localNotesEnabled(req.headers.get("host"))) return Response.json({ error: "unavailable" }, { status: 404 });
  try {
    return new Response(await readAppleNotes(), { headers: { "content-type": "application/json" } });
  } catch (e) {
    if (e instanceof NotesPermissionError) return Response.json({ error: "permission" }, { status: 403 });
    return Response.json({ error: "notes_failed" }, { status: 500 });
  }
}

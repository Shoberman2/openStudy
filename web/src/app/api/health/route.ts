import { aiEnabled } from "@/lib/server/claude";
import { localNotesEnabled } from "@/lib/server/notes";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return Response.json({ ai: aiEnabled(), notes: localNotesEnabled(req.headers.get("host")) });
}

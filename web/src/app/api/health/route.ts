import { aiEnabled } from "@/lib/server/claude";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ai: aiEnabled() });
}

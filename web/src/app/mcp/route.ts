// The OpenStudy study MCP over streamable HTTP (spec 15.7). Public by design: anyone can use Demo mode.
// A model key is only spent for callers with OPENSTUDY_STUDY_MCP_TOKEN, or everyone if the owner opts in
// with OPENSTUDY_STUDY_MCP_PUBLIC_AI=1, so an open URL can never run up a bill on its own.
import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import type { Ai } from "@/engine/tutor/service";
import { tutorAi } from "@/lib/server/tutor-ai";
import { INSTRUCTIONS, registerStudyTools, SERVER_INFO } from "@/mcp/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const handlerFor = (ai: Ai | null) => createMcpHandler((server) => registerStudyTools(server, ai), { serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });

function mayUseModel(req: Request): boolean {
  if (process.env.OPENSTUDY_STUDY_MCP_PUBLIC_AI === "1") return true;
  const want = process.env.OPENSTUDY_STUDY_MCP_TOKEN;
  const got = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!want || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handler(req: Request): Promise<Response> {
  return handlerFor(mayUseModel(req) ? tutorAi() : null)(req);
}

export { handler as GET, handler as POST, handler as DELETE };

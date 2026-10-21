// The OpenStudy MCP (spec 12.4): read-only owner analytics for Claude and Codex.
// Auth: Authorization: Bearer ${OPENSTUDY_MCP_TOKEN}.
import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { funnel, overview, since, sorting, study, uploads, type Account, type PlusRow } from "@/engine/analytics";
import { compEmails } from "@/lib/server/billing";
import { loadAccounts, loadEvents, loadPlus, recentEvents } from "@/lib/server/analytics";

export const dynamic = "force-dynamic";

const days = z.number().int().min(1).max(365).default(30).describe("How many days back to look (default 30)");
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

const mcp = createMcpHandler(
  (server) => {
    server.registerTool(
      "overview",
      {
        title: "Overview",
        description: "Accounts, active installs by platform, OpenStudy Plus status counts and the most common events in the window.",
        inputSchema: z.object({ days }),
      },
      async ({ days }) => {
        const now = new Date();
        const [rows, accounts, plus] = await Promise.all([loadEvents(since(now, days)), loadAccounts(), loadPlus()]);
        return json(overview(rows, accounts, withComp(accounts, plus), now, days));
      },
    );
    server.registerTool(
      "uploads",
      {
        title: "Uploads",
        description: "What people import: imports by kind (photo, scan, files, note, ...), file types (pdf, image, pptx, ...), pages added, duplicates, per platform and per day, plus Photos sweeps.",
        inputSchema: z.object({ days }),
      },
      async ({ days }) => {
        const now = new Date();
        return json(uploads(await loadEvents(since(now, days)), now, days));
      },
    );
    server.registerTool(
      "sorting",
      {
        title: "Sorting",
        description: "What people sort their material into: projects by type (book, class, other) and category (Biology, Reading, Work, ...), suggested categories on the Sort screen, category changes, and the share of imported pages filed into projects.",
        inputSchema: z.object({ days }),
      },
      async ({ days }) => {
        const now = new Date();
        return json(sorting(await loadEvents(since(now, days)), now, days));
      },
    );
    server.registerTool(
      "funnel",
      {
        title: "Weekly cohort funnel",
        description: "Installs grouped by the week they first appeared, with the percent that imported, made a project, finished a study session, made an account and are on Plus.",
        inputSchema: z.object({ weeks: z.number().int().min(1).max(52).default(8).describe("How many weeks of cohorts (default 8)") }),
      },
      async ({ weeks }) => {
        const now = new Date();
        const [rows, plus, accounts] = await Promise.all([loadEvents(since(now, weeks * 7 + 7)), loadPlus(), loadAccounts()]);
        return json(funnel(rows, withComp(accounts, plus), now, weeks));
      },
    );
    server.registerTool(
      "study",
      {
        title: "Study",
        description: "Study sessions and reviews started and finished, average accuracy, minutes, XP, lesson kinds, practice tests, Ask questions, concept questions per session, and what people pick on \"What do you want to focus on?\" (focus: set, everything, avgChosen, avgOffered).",
        inputSchema: z.object({ days }),
      },
      async ({ days }) => {
        const now = new Date();
        return json(study(await loadEvents(since(now, days)), now, days));
      },
    );
    server.registerTool(
      "events",
      {
        title: "Recent events",
        description: "Raw recent events, newest first. Props hold only categories and counts.",
        inputSchema: z.object({
          name: z.string().optional().describe("Only this event name, e.g. import, project_created, sort_done"),
          platform: z.enum(["ios", "web"]).optional(),
          limit: z.number().int().min(1).max(500).default(50),
        }),
      },
      async ({ name, platform, limit }) => json(await recentEvents(limit, { name, platform })),
    );
    server.registerTool(
      "users",
      {
        title: "Accounts",
        description: "Accounts with their sign-up date, Plus status, last event time and event count.",
        inputSchema: z.object({
          email: z.string().optional().describe("Only emails containing this text"),
          limit: z.number().int().min(1).max(500).default(50),
        }),
      },
      async ({ email, limit }) => {
        const now = new Date();
        const [accounts, plus, rows] = await Promise.all([loadAccounts(), loadPlus(), loadEvents(since(now, 365))]);
        const status = new Map(plus.map((p) => [p.user_id, p.status]));
        const comp = compEmails();
        const last = new Map<string, { at: string; n: number }>();
        for (const r of rows) {
          if (!r.user_id) continue;
          const cur = last.get(r.user_id) ?? { at: r.t, n: 0 };
          last.set(r.user_id, { at: r.t > cur.at ? r.t : cur.at, n: cur.n + 1 });
        }
        const q = email?.toLowerCase();
        return json(
          accounts
            .filter((a) => !q || a.email?.toLowerCase().includes(q))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, limit)
            .map((a) => ({
              email: a.email,
              createdAt: a.created_at,
              plus: status.get(a.id) ?? (a.email && comp.includes(a.email.toLowerCase()) ? "comp" : "none"),
              lastEventAt: last.get(a.id)?.at ?? null,
              events: last.get(a.id)?.n ?? 0,
            })),
        );
      },
    );
  },
  { serverInfo: { name: "openstudy", version: "1.0.0" } },
);

/** Comped owner emails (OPENSTUDY_COMP_EMAILS) count as Plus even without an entitlements row. */
function withComp(accounts: Account[], plus: PlusRow[]): PlusRow[] {
  const comp = compEmails();
  const has = new Set(plus.map((p) => p.user_id));
  return [...plus, ...accounts.filter((a) => !has.has(a.id) && a.email && comp.includes(a.email.toLowerCase())).map((a) => ({ user_id: a.id, status: "comp" }))];
}

function authorized(req: Request): boolean {
  const want = process.env.OPENSTUDY_MCP_TOKEN;
  const got = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!want || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handler(req: Request): Promise<Response> {
  if (!process.env.OPENSTUDY_MCP_TOKEN) return Response.json({ error: "mcp_off" }, { status: 503 });
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return mcp(req);
}

export { handler as GET, handler as POST, handler as DELETE };

// Usage data from the apps (spec 12.3). Anyone may send; the server keeps only categories and counts.
import { cleanEvents } from "@/engine/events";
import { adminClient, billingEnabled, userFromRequest } from "@/lib/server/billing";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  if (!billingEnabled()) return Response.json({ stored: 0 });
  const body = (await req.json().catch(() => null)) as { installId?: unknown; platform?: unknown; appVersion?: unknown; events?: unknown } | null;
  if (!body || typeof body.installId !== "string" || !UUID.test(body.installId)) return Response.json({ error: "install" }, { status: 400 });
  const events = cleanEvents(body.events);
  if (!events.length) return Response.json({ stored: 0 });
  const user = req.headers.get("authorization") ? await userFromRequest(req) : null;
  const platform = body.platform === "ios" ? "ios" : "web";
  const appVersion = typeof body.appVersion === "string" ? body.appVersion.slice(0, 20) : null;
  const { error } = await adminClient()
    .from("events")
    .insert(events.map((e) => ({ ...e, install_id: body.installId, user_id: user?.id ?? null, platform, app_version: appVersion })));
  if (error) return Response.json({ error: "server" }, { status: 500 });
  return Response.json({ stored: events.length });
}

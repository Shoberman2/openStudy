import "server-only";
// Loads usage rows for the owner MCP (spec 12.4). Aggregation lives in engine/analytics.
import type { Account, EventRow, PlusRow } from "@/engine/analytics";
import { adminClient } from "./billing";

const PAGE = 1000;
const MAX_ROWS = 200_000;

export async function loadEvents(fromIso: string, filter: { name?: string; platform?: string } = {}): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  for (let start = 0; start < MAX_ROWS; start += PAGE) {
    let q = adminClient().from("events").select("t,install_id,user_id,platform,name,props").gte("t", fromIso);
    if (filter.name) q = q.eq("name", filter.name);
    if (filter.platform) q = q.eq("platform", filter.platform);
    const { data, error } = await q.order("t", { ascending: true }).range(start, start + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as EventRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function recentEvents(limit: number, filter: { name?: string; platform?: string }): Promise<(EventRow & { app_version: string | null })[]> {
  let q = adminClient().from("events").select("t,install_id,user_id,platform,app_version,name,props");
  if (filter.name) q = q.eq("name", filter.name);
  if (filter.platform) q = q.eq("platform", filter.platform);
  const { data, error } = await q.order("t", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as (EventRow & { app_version: string | null })[];
}

export async function loadAccounts(): Promise<Account[]> {
  const out: Account[] = [];
  for (let page = 1; page < 100; page++) {
    const { data, error } = await adminClient().auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw error;
    out.push(...data.users.map((u) => ({ id: u.id, email: u.email, created_at: u.created_at })));
    if (data.users.length < PAGE) break;
  }
  return out;
}

export async function loadPlus(): Promise<PlusRow[]> {
  const { data, error } = await adminClient().from("entitlements").select("user_id,status");
  if (error) throw error;
  return (data ?? []) as PlusRow[];
}

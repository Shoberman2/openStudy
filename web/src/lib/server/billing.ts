import "server-only";
// Accounts and entitlements on the server (spec 11.4). Supabase Auth issues the user's JWT; the
// entitlements table is written only here, with the service role key.
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { compList, entitlementFor, shouldWrite, type EntitlementRow } from "@/engine/billing";
import type { Entitlement } from "@/engine/profile";

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = () => process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
export const publishableKey = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function billingEnabled(): boolean {
  return !!(supabaseUrl() && serviceKey() && publishableKey());
}

export function billingOff(): Response {
  return Response.json({ error: "billing_off" }, { status: 503 });
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  admin ??= createClient(supabaseUrl()!, serviceKey()!, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** The user behind `Authorization: Bearer <Supabase access token>`, or null. */
export async function userFromRequest(req: Request): Promise<User | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  const { data, error } = await adminClient().auth.getUser(m[1]);
  return error ? null : data.user;
}

export const compEmails = () => compList(process.env.OPENSTUDY_COMP_EMAILS);

export async function readRow(userId: string): Promise<EntitlementRow | null> {
  const { data, error } = await adminClient().from("entitlements").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return (data as EntitlementRow | null) ?? null;
}

export async function entitlementOf(user: User): Promise<Entitlement> {
  return entitlementFor(await readRow(user.id), user.email, compEmails());
}

/** Upsert a store event for a user unless it would clobber an active subscription from the other store. */
export async function writeRow(row: EntitlementRow): Promise<boolean> {
  const existing = await readRow(row.user_id);
  if (!shouldWrite(existing, row)) return false;
  const { error } = await adminClient()
    .from("entitlements")
    .upsert({ ...existing, ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
  return true;
}

export async function userIdBy(column: "original_transaction_id" | "stripe_customer_id", value: string): Promise<string | null> {
  const { data, error } = await adminClient().from("entitlements").select("user_id").eq(column, value).maybeSingle();
  if (error) throw error;
  return (data as { user_id: string } | null)?.user_id ?? null;
}

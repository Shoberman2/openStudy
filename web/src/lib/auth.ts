"use client";

// Supabase Auth on the web and the account's entitlement (spec 11.4, 11.5, 12.1). Sign in is by
// email and password, with no emails to wait for. The library itself stays local; the account
// exists for the subscription.
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { offlineEntitlement, type CachedEntitlement } from "@/engine/billing";
import type { Entitlement } from "@/engine/profile";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CACHE_KEY = "openstudy.entitlement";

export const authConfigured = (): boolean => !!(URL_ && KEY);

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  if (!authConfigured()) return null;
  client ??= createBrowserClient(URL_!, KEY!);
  return client;
}

export type Me = { userId: string; email?: string; entitlement: Entitlement };
export type MeResult = { kind: "off" } | { kind: "signed-out" } | { kind: "me"; me: Me; offline?: boolean };

export async function accessToken(): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

function readCache(): CachedEntitlement | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedEntitlement) : null;
  } catch {
    return null;
  }
}

function writeCache(c: CachedEntitlement | null) {
  try {
    if (c) localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* storage unavailable: the next load asks the server again */
  }
}

/** The signed-in account and its entitlement, using the cached state when the server is unreachable. */
export async function fetchMe(): Promise<MeResult> {
  const sb = supabase();
  if (!sb) return { kind: "off" };
  const { data } = await sb.auth.getSession();
  const session = data.session;
  if (!session) return { kind: "signed-out" };
  try {
    const r = await fetch("/api/me", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
    if (r.status === 503) return { kind: "off" };
    if (r.status === 401) {
      await sb.auth.signOut();
      writeCache(null);
      return { kind: "signed-out" };
    }
    if (!r.ok) throw new Error(String(r.status));
    const body = (await r.json()) as { user: { id: string; email?: string }; entitlement: Entitlement };
    writeCache({ entitlement: body.entitlement, userId: body.user.id, fetchedAt: new Date().toISOString() });
    return { kind: "me", me: { userId: body.user.id, email: body.user.email, entitlement: body.entitlement } };
  } catch {
    const cached = offlineEntitlement(readCache(), session.user.id);
    return {
      kind: "me",
      offline: true,
      me: { userId: session.user.id, email: session.user.email, entitlement: cached ?? { active: false, status: "none" } },
    };
  }
}

export type AuthMode = "create" | "signin";

/** Creates an account or signs in. Returns an error message, or null when signed in. */
export async function passwordAuth(mode: AuthMode, email: string, password: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return "Accounts are not set up on this server yet.";
  if (mode === "create" && password.length < 8) return "Use at least 8 characters.";
  try {
    if (mode === "create") {
      const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
      if (error) return /already|registered|exists/i.test(error.message) ? "That email already has an account. Sign in instead." : authError(error);
      // With email confirmation off Supabase returns a session; an existing address comes back without identities.
      if (!data.session || data.user?.identities?.length === 0) return "That email already has an account. Sign in instead.";
      void welcome(data.session.access_token);
      return null;
    }
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    return error ? authError(error) : null;
  } catch {
    return "Could not reach OpenStudy. Check your connection.";
  }
}

function authError(error: { status?: number; message: string }): string {
  if (/password/i.test(error.message) && /characters|short|weak/i.test(error.message)) return "Use at least 8 characters.";
  if (error.status === 429) return "Too many tries. Wait a minute and try again.";
  if (!error.status || error.status >= 500) return "Could not reach OpenStudy. Check your connection.";
  return "Wrong email or password.";
}

async function welcome(token: string) {
  const { installId } = await import("./events");
  await fetch("/api/welcome", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ installId: installId(), platform: "web" }),
  }).catch(() => undefined);
}

/** "sent", "off" when email is not set up on the server, or "failed". */
export async function requestPasswordReset(email: string): Promise<"sent" | "off" | "failed"> {
  try {
    const r = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
    return r.ok ? "sent" : r.status === 503 ? "off" : "failed";
  } catch {
    return "failed";
  }
}

/** Finishes a reset link: signs in with its token, then sets the new password. */
export async function setNewPassword(tokenHash: string, password: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return "Accounts are not set up on this server yet.";
  if (password.length < 8) return "Use at least 8 characters.";
  const { error } = await sb.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error) return "That link did not work. Ask for a new one.";
  const r = await sb.auth.updateUser({ password });
  return r.error ? "Could not save the new password. Try again." : null;
}

export async function signOut(): Promise<void> {
  writeCache(null);
  await supabase()?.auth.signOut();
}

async function authedPost(path: string, method = "POST"): Promise<Response | null> {
  const token = await accessToken();
  if (!token) return null;
  return fetch(path, { method, headers: { Authorization: `Bearer ${token}` } });
}

export type StartResult = { url: string } | { error: "signed-out" | "apple_subscriber" | "already_subscribed" | "comp" | "off" | "failed" };

/** Starts Stripe Checkout (7 days free, then $10 a month). */
export async function startCheckout(): Promise<StartResult> {
  const r = await authedPost("/api/stripe/checkout");
  if (!r) return { error: "signed-out" };
  if (r.status === 503) return { error: "off" };
  const body = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  if (r.ok && body.url) return { url: body.url };
  if (body.error === "apple_subscriber" || body.error === "already_subscribed" || body.error === "comp") return { error: body.error };
  return { error: "failed" };
}

export async function billingPortal(): Promise<string | null> {
  const r = await authedPost("/api/stripe/portal");
  if (!r?.ok) return null;
  return ((await r.json()) as { url?: string }).url ?? null;
}

export async function deleteAccount(): Promise<boolean> {
  const r = await authedPost("/api/me", "DELETE");
  if (!r?.ok) return false;
  await signOut();
  return true;
}

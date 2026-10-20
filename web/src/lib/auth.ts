"use client";

// Supabase Auth on the web and the account's entitlement (spec 11.4, 11.5). Sign in is by email:
// a sign-in link (always) and a 6-digit code when the project's email template includes one.
// The library itself stays local; the account exists for the subscription.
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

/** Sends the sign-in email. `next` is the in-app path to return to after the link is opened. */
export async function sendSignInEmail(email: string, next = "/app/profile"): Promise<string | null> {
  const sb = supabase();
  if (!sb) return "Accounts are not set up on this server yet.";
  const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect, shouldCreateUser: true } });
  if (!error) return null;
  if (error.status === 429) return "Too many emails. Wait a minute and try again.";
  return "We could not send the email. Check the address and try again.";
}

export async function verifyEmailCode(email: string, code: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return "Accounts are not set up on this server yet.";
  const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.replace(/\s/g, ""), type: "email" });
  return error ? "That code did not work. Check it, or use the link in the email." : null;
}

/** Finishes a sign-in link (PKCE): `code` from the callback URL. */
export async function exchangeSignInCode(code: string): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;
  const { error } = await sb.auth.exchangeCodeForSession(code);
  return !error;
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

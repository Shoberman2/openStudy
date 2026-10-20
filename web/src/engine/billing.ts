// Entitlement rules for OpenStudy Plus (spec 11.4, 11.5). Pure: shared by the API routes, the
// client cache and the tests.
import type { Entitlement, EntitlementStatus } from "./profile";

export const PLUS_PRODUCT_ID = "com.openstudy.shelf.plus.monthly";
export const STRIPE_LOOKUP_KEY = "openstudy_plus_monthly";
export const TRIAL_DAYS = 7;
/** How long a cached entitlement is trusted past its end date when the server cannot be reached. */
export const OFFLINE_GRACE_MS = 3 * 86_400_000;

export type EntitlementRow = {
  user_id: string;
  status: Exclude<EntitlementStatus, "none">;
  source: "apple" | "stripe" | "comp";
  product?: string | null;
  renews_at?: string | null;
  trial_ends_at?: string | null;
  original_transaction_id?: string | null;
  stripe_customer_id?: string | null;
  updated_at?: string;
};

export function compList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isComp(email: string | undefined | null, comp: string[]): boolean {
  return !!email && comp.includes(email.trim().toLowerCase());
}

/** The end of the period the row pays for: trial end while trialing, else the renewal date. */
function periodEnd(row: Pick<EntitlementRow, "status" | "renews_at" | "trial_ends_at">): number | null {
  const iso = row.status === "trialing" ? row.trial_ends_at ?? row.renews_at : row.renews_at;
  return iso ? Date.parse(iso) : null;
}

/**
 * active = trialing, active or comp and not past its end date. A canceled subscription stays
 * active until the period the user already paid for ends ("OpenStudy Plus until Nov 20").
 */
export function isActive(row: Pick<EntitlementRow, "status" | "renews_at" | "trial_ends_at"> | null, now: Date = new Date()): boolean {
  if (!row) return false;
  if (row.status === "comp") return true;
  if (row.status !== "trialing" && row.status !== "active" && row.status !== "canceled") return false;
  const end = periodEnd(row);
  if (row.status === "canceled") return end !== null && end > now.getTime();
  return end === null || end > now.getTime();
}

export function entitlementFor(row: EntitlementRow | null, email: string | undefined | null, comp: string[], now: Date = new Date()): Entitlement {
  if (isComp(email, comp)) return { active: true, status: "comp", source: "comp" };
  if (!row) return { active: false, status: "none" };
  return {
    active: isActive(row, now),
    status: row.status,
    source: row.source,
    renewsAt: row.renews_at ?? undefined,
    trialEndsAt: row.trial_ends_at ?? undefined,
  };
}

/**
 * Whether an incoming store event may replace the stored row. One subscription per account: an
 * inactive event from one store never overwrites an active subscription from the other.
 */
export function shouldWrite(existing: EntitlementRow | null, incoming: EntitlementRow, now: Date = new Date()): boolean {
  if (!existing || existing.source === incoming.source) return true;
  if (existing.status === "comp") return false;
  return isActive(incoming, now) || !isActive(existing, now);
}

// ---- App Store (decoded, already verified JWS payloads) ----

export type AppleTx = {
  productId?: string;
  bundleId?: string;
  originalTransactionId?: string;
  appAccountToken?: string;
  expiresDate?: number;
  revocationDate?: number;
  offerType?: number;
  offerDiscountType?: string;
};
export type AppleRenewal = { autoRenewStatus?: number; gracePeriodExpiresDate?: number };

const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : null);

/** Entitlement row from a verified App Store transaction (and renewal info when a notification carries it). */
export function appleRow(userId: string, tx: AppleTx, renewal: AppleRenewal | null, notification: string | null, now: Date = new Date()): EntitlementRow {
  const base = { user_id: userId, source: "apple" as const, product: tx.productId ?? null, original_transaction_id: tx.originalTransactionId ?? null };
  const expired = (status: EntitlementRow["status"] = "expired"): EntitlementRow => ({ ...base, status, renews_at: iso(tx.expiresDate), trial_ends_at: null });
  if (tx.revocationDate || notification === "REFUND" || notification === "REVOKE") return expired();
  if (notification === "EXPIRED" || notification === "GRACE_PERIOD_EXPIRED") return expired();
  if (notification === "DID_FAIL_TO_RENEW") {
    if (renewal?.gracePeriodExpiresDate && renewal.gracePeriodExpiresDate > now.getTime())
      return { ...base, status: "active", renews_at: iso(renewal.gracePeriodExpiresDate), trial_ends_at: null };
    return expired("past_due");
  }
  if (tx.expiresDate && tx.expiresDate <= now.getTime()) return expired();
  const trial = tx.offerType === 1 && tx.offerDiscountType === "FREE_TRIAL";
  const renewOff = renewal?.autoRenewStatus === 0;
  if (trial && !renewOff) return { ...base, status: "trialing", renews_at: iso(tx.expiresDate), trial_ends_at: iso(tx.expiresDate) };
  return { ...base, status: renewOff ? "canceled" : "active", renews_at: iso(tx.expiresDate), trial_ends_at: null };
}

// ---- Stripe ----

export type StripeSubLike = {
  status: string;
  cancel_at_period_end?: boolean | null;
  trial_end?: number | null;
  current_period_end?: number | null;
  items?: { data?: { current_period_end?: number | null }[] };
  customer: string | { id: string };
};

/** Entitlement row from a Stripe subscription (period end lives on the items in newer API versions). */
export function stripeRow(userId: string, sub: StripeSubLike): EntitlementRow {
  const end = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? null;
  const at = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const base = { user_id: userId, source: "stripe" as const, product: STRIPE_LOOKUP_KEY, stripe_customer_id: customer };
  switch (sub.status) {
    case "trialing":
      return { ...base, status: sub.cancel_at_period_end ? "canceled" : "trialing", trial_ends_at: at(sub.trial_end), renews_at: at(sub.trial_end ?? end) };
    case "active":
      return { ...base, status: sub.cancel_at_period_end ? "canceled" : "active", renews_at: at(end), trial_ends_at: null };
    case "past_due":
    case "unpaid":
      return { ...base, status: "past_due", renews_at: at(end), trial_ends_at: null };
    default:
      return { ...base, status: "expired", renews_at: at(end), trial_ends_at: null };
  }
}

// ---- Client cache (11.5 offline grace) ----

export type CachedEntitlement = { entitlement: Entitlement; userId: string; fetchedAt: string };

/** The cached entitlement to use when the server cannot be reached, or null when it has lapsed. */
export function offlineEntitlement(cache: CachedEntitlement | null, userId: string | undefined, now: Date = new Date()): Entitlement | null {
  if (!cache || !userId || cache.userId !== userId) return null;
  const e = cache.entitlement;
  if (!e.active) return e;
  if (e.status === "comp") return e;
  const endIso = e.status === "trialing" ? e.trialEndsAt ?? e.renewsAt : e.renewsAt;
  if (!endIso) return Date.parse(cache.fetchedAt) + OFFLINE_GRACE_MS > now.getTime() ? e : { ...e, active: false };
  return Date.parse(endIso) + OFFLINE_GRACE_MS > now.getTime() ? e : { ...e, active: false };
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appleRow, compList, entitlementFor, isActive, offlineEntitlement, shouldWrite, stripeRow, type EntitlementRow } from "./billing";

const NOW = new Date("2026-10-20T12:00:00Z");
const day = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const row = (r: Partial<EntitlementRow>): EntitlementRow => ({ user_id: "u1", status: "active", source: "apple", ...r });

describe("entitlement rules (11.4)", () => {
  it("comp emails are free, case-insensitive, without a row", () => {
    const comp = compList(" Ancientbest@gmail.com, shoberman@icloud.com ,");
    expect(comp).toEqual(["ancientbest@gmail.com", "shoberman@icloud.com"]);
    expect(entitlementFor(null, "ANCIENTBEST@gmail.com", comp, NOW)).toEqual({ active: true, status: "comp", source: "comp" });
    expect(entitlementFor(null, "someone@else.com", comp, NOW)).toEqual({ active: false, status: "none" });
  });

  it("active means trialing, active or comp and not past the end", () => {
    expect(isActive(row({ status: "active", renews_at: at(day) }), NOW)).toBe(true);
    expect(isActive(row({ status: "active", renews_at: at(-day) }), NOW)).toBe(false);
    expect(isActive(row({ status: "trialing", trial_ends_at: at(2 * day) }), NOW)).toBe(true);
    expect(isActive(row({ status: "trialing", trial_ends_at: at(-1) }), NOW)).toBe(false);
    expect(isActive(row({ status: "past_due", renews_at: at(day) }), NOW)).toBe(false);
    expect(isActive(row({ status: "expired" }), NOW)).toBe(false);
    expect(isActive(row({ status: "comp", source: "comp" }), NOW)).toBe(true);
  });

  it("a canceled subscription stays on until the paid period ends", () => {
    expect(isActive(row({ status: "canceled", renews_at: at(5 * day) }), NOW)).toBe(true);
    expect(isActive(row({ status: "canceled", renews_at: at(-day) }), NOW)).toBe(false);
    expect(isActive(row({ status: "canceled" }), NOW)).toBe(false);
  });

  it("an inactive event from one store never overwrites an active one from the other", () => {
    const apple = row({ source: "apple", status: "active", renews_at: at(10 * day) });
    expect(shouldWrite(apple, row({ source: "stripe", status: "expired" }), NOW)).toBe(false);
    expect(shouldWrite(apple, row({ source: "apple", status: "expired" }), NOW)).toBe(true);
    expect(shouldWrite(apple, row({ source: "stripe", status: "active", renews_at: at(30 * day) }), NOW)).toBe(true);
    expect(shouldWrite(null, row({ source: "stripe", status: "trialing" }), NOW)).toBe(true);
  });
});

describe("App Store transactions (11.5)", () => {
  const tx = { productId: "com.openstudy.shelf.plus.monthly", originalTransactionId: "100", expiresDate: NOW.getTime() + 7 * day };
  it("free trial intro offer -> trialing until expiry", () => {
    const r = appleRow("u1", { ...tx, offerType: 1, offerDiscountType: "FREE_TRIAL" }, null, null, NOW);
    expect(r.status).toBe("trialing");
    expect(r.trial_ends_at).toBe(at(7 * day));
  });
  it("paid period -> active, auto renew off -> canceled, refund -> expired", () => {
    expect(appleRow("u1", tx, null, null, NOW).status).toBe("active");
    expect(appleRow("u1", tx, { autoRenewStatus: 0 }, "DID_CHANGE_RENEWAL_STATUS", NOW).status).toBe("canceled");
    expect(appleRow("u1", tx, null, "REFUND", NOW).status).toBe("expired");
    expect(appleRow("u1", { ...tx, expiresDate: NOW.getTime() - 1 }, null, null, NOW).status).toBe("expired");
  });
  it("billing retry: grace period keeps access, otherwise past_due", () => {
    expect(appleRow("u1", tx, { gracePeriodExpiresDate: NOW.getTime() + day }, "DID_FAIL_TO_RENEW", NOW).status).toBe("active");
    expect(appleRow("u1", tx, null, "DID_FAIL_TO_RENEW", NOW).status).toBe("past_due");
  });
});

describe("Stripe subscriptions (11.5)", () => {
  const s = (status: string, extra: object = {}) => ({ status, customer: "cus_1", items: { data: [{ current_period_end: (NOW.getTime() + 30 * day) / 1000 }] }, ...extra });
  it("maps statuses", () => {
    expect(stripeRow("u1", s("trialing", { trial_end: (NOW.getTime() + 7 * day) / 1000 }))).toMatchObject({ status: "trialing", trial_ends_at: at(7 * day), stripe_customer_id: "cus_1" });
    expect(stripeRow("u1", s("active")).status).toBe("active");
    expect(stripeRow("u1", s("active", { cancel_at_period_end: true })).status).toBe("canceled");
    expect(stripeRow("u1", s("past_due")).status).toBe("past_due");
    expect(stripeRow("u1", s("canceled")).status).toBe("expired");
    expect(stripeRow("u1", s("active")).renews_at).toBe(at(30 * day));
  });
});

describe("offline grace (11.5)", () => {
  const cache = (e: object, fetchedAt = NOW.toISOString()) => ({ userId: "u1", fetchedAt, entitlement: { active: true, status: "active" as const, ...e } });
  it("uses the cache until the end date plus 3 days", () => {
    expect(offlineEntitlement(cache({ renewsAt: at(-2 * day) }), "u1", NOW)?.active).toBe(true);
    expect(offlineEntitlement(cache({ renewsAt: at(-4 * day) }), "u1", NOW)?.active).toBe(false);
    expect(offlineEntitlement(cache({ status: "trialing", trialEndsAt: at(day) }), "u1", NOW)?.active).toBe(true);
  });
  it("ignores another account's cache and keeps comp", () => {
    expect(offlineEntitlement(cache({}), "u2", NOW)).toBeNull();
    expect(offlineEntitlement(cache({ status: "comp" }, at(-90 * day)), "u1", NOW)?.active).toBe(true);
  });
});

describe("routes", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.doUnmock("@supabase/supabase-js");
  });

  it("answer 503 billing_off when Supabase is not configured", async () => {
    for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) delete process.env[k];
    const me = await import("@/app/api/me/route");
    const r = await me.GET(new Request("http://x/api/me"));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "billing_off" });
    const cfg = await import("@/app/api/config/route");
    expect(await cfg.GET().json()).toEqual({ billing: false });
  });

  it("/api/me: 401 without a token, comp for the owner's email", async () => {
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "sk",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk",
      OPENSTUDY_COMP_EMAILS: "ancientbest@gmail.com,shoberman@icloud.com",
    });
    const users: Record<string, { id: string; email: string }> = { owner: { id: "u-owner", email: "Shoberman@icloud.com" }, paid: { id: "u-paid", email: "a@b.co" } };
    const rows: Record<string, EntitlementRow> = { "u-paid": row({ user_id: "u-paid", status: "trialing", trial_ends_at: at(3 * day) }) };
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({
        auth: { getUser: async (t: string) => (users[t] ? { data: { user: users[t] }, error: null } : { data: { user: null }, error: new Error("bad") }) },
        from: () => ({ select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: rows[id] ?? null, error: null }) }) }) }),
      }),
    }));
    const { GET } = await import("@/app/api/me/route");
    expect((await GET(new Request("http://x/api/me"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/me", { headers: { Authorization: "Bearer nope" } }))).status).toBe(401);
    const owner = await (await GET(new Request("http://x/api/me", { headers: { Authorization: "Bearer owner" } }))).json();
    expect(owner).toEqual({ user: { id: "u-owner", email: "Shoberman@icloud.com" }, entitlement: { active: true, status: "comp", source: "comp" } });
    const paid = await (await GET(new Request("http://x/api/me", { headers: { Authorization: "Bearer paid" } }))).json();
    expect(paid.entitlement).toMatchObject({ status: "trialing", source: "apple" });
  });
});

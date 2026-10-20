import "server-only";
// Web payments for OpenStudy Plus (spec 11.5): Stripe Checkout in subscription mode with a 7-day
// trial, the billing portal, and the webhook that keeps the entitlement current.
import Stripe from "stripe";
import { STRIPE_LOOKUP_KEY, TRIAL_DAYS } from "@/engine/billing";

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

let client: Stripe | null = null;
export function stripe(): Stripe {
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY!);
  return client;
}

/** The $10/month price, found by lookup key and created on first use. */
export async function plusPrice(): Promise<string> {
  const found = await stripe().prices.list({ lookup_keys: [STRIPE_LOOKUP_KEY], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const price = await stripe().prices.create({
    currency: "usd",
    unit_amount: 1000,
    recurring: { interval: "month" },
    lookup_key: STRIPE_LOOKUP_KEY,
    product_data: { name: "OpenStudy Plus" },
  });
  return price.id;
}

export async function checkoutUrl(opts: { userId: string; email?: string; customer?: string | null; origin: string; trial: boolean }): Promise<string> {
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: await plusPrice(), quantity: 1 }],
    client_reference_id: opts.userId,
    ...(opts.customer ? { customer: opts.customer } : { customer_email: opts.email }),
    subscription_data: { metadata: { user_id: opts.userId }, ...(opts.trial ? { trial_period_days: TRIAL_DAYS } : {}) },
    metadata: { user_id: opts.userId },
    allow_promotion_codes: true,
    success_url: `${opts.origin}/app/profile?plus=started`,
    cancel_url: `${opts.origin}/app/plus?canceled=1`,
  });
  return session.url!;
}

export async function portalUrl(customer: string, origin: string): Promise<string> {
  const session = await stripe().billingPortal.sessions.create({ customer, return_url: `${origin}/app/profile` });
  return session.url;
}

export async function cancelStripeSubscriptions(customer: string): Promise<void> {
  if (!stripeEnabled()) return;
  const subs = await stripe().subscriptions.list({ customer, status: "all", limit: 20 });
  for (const s of subs.data) if (!["canceled", "incomplete_expired"].includes(s.status)) await stripe().subscriptions.cancel(s.id);
}

/** Origin for Stripe redirects: the request's own origin (works for localhost, previews and production). */
export function originOf(req: Request): string {
  return new URL(req.url).origin;
}

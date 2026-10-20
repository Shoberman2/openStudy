// Stripe webhook (spec 11.5): signature verified with STRIPE_WEBHOOK_SECRET, then the
// subscription's state is written to the account's entitlement.
import type Stripe from "stripe";
import { stripeRow } from "@/engine/billing";
import { billingEnabled, billingOff, userIdBy, writeRow } from "@/lib/server/billing";
import { stripe, stripeEnabled } from "@/lib/server/stripe";

export const dynamic = "force-dynamic";

async function userFor(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.user_id;
  if (fromMeta) return fromMeta;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  return userIdBy("stripe_customer_id", customer);
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!billingEnabled() || !stripeEnabled() || !secret) return billingOff();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return Response.json({ error: "bad_request" }, { status: 400 });
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(await req.text(), sig, secret);
  } catch {
    return Response.json({ error: "bad_signature" }, { status: 400 });
  }
  let sub: Stripe.Subscription | null = null;
  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    if (s.mode === "subscription" && s.subscription) {
      sub = await stripe().subscriptions.retrieve(typeof s.subscription === "string" ? s.subscription : s.subscription.id);
      if (!sub.metadata?.user_id && s.client_reference_id) sub.metadata = { ...sub.metadata, user_id: s.client_reference_id };
    }
  } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    sub = event.data.object;
  }
  if (!sub) return Response.json({ ok: true });
  const userId = await userFor(sub);
  if (!userId) return Response.json({ ok: true });
  try {
    await writeRow(stripeRow(userId, sub as unknown as Parameters<typeof stripeRow>[1]));
  } catch (e) {
    if ((e as { code?: string }).code !== "23503") return Response.json({ error: "server" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

// Starts a Stripe Checkout for OpenStudy Plus (spec 11.5). Returns {url} to redirect to.
import { isActive, isComp } from "@/engine/billing";
import { billingEnabled, billingOff, compEmails, readRow, unauthorized, userFromRequest } from "@/lib/server/billing";
import { checkoutUrl, originOf, stripeEnabled } from "@/lib/server/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!billingEnabled() || !stripeEnabled()) return billingOff();
  const user = await userFromRequest(req);
  if (!user) return unauthorized();
  if (isComp(user.email, compEmails())) return Response.json({ error: "comp" }, { status: 409 });
  const row = await readRow(user.id);
  if (row && isActive(row)) {
    return Response.json({ error: row.source === "apple" ? "apple_subscriber" : "already_subscribed" }, { status: 409 });
  }
  try {
    // One free trial per account: anyone who already had a subscription row pays from day one.
    const url = await checkoutUrl({ userId: user.id, email: user.email, customer: row?.stripe_customer_id, origin: originOf(req), trial: !row });
    return Response.json({ url });
  } catch {
    return Response.json({ error: "stripe" }, { status: 502 });
  }
}

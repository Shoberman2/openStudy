// Opens the Stripe billing portal for a web subscriber (spec 11.3 "Manage subscription").
import { billingEnabled, billingOff, readRow, unauthorized, userFromRequest } from "@/lib/server/billing";
import { originOf, portalUrl, stripeEnabled } from "@/lib/server/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!billingEnabled() || !stripeEnabled()) return billingOff();
  const user = await userFromRequest(req);
  if (!user) return unauthorized();
  const row = await readRow(user.id);
  if (row?.source === "apple") return Response.json({ error: "apple_subscriber" }, { status: 409 });
  if (!row?.stripe_customer_id) return Response.json({ error: "no_subscription" }, { status: 404 });
  try {
    return Response.json({ url: await portalUrl(row.stripe_customer_id, originOf(req)) });
  } catch {
    return Response.json({ error: "stripe" }, { status: 502 });
  }
}

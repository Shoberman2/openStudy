// The signed-in account and its entitlement (spec 11.4). DELETE removes the account.
import { adminClient, billingEnabled, billingOff, entitlementOf, readRow, unauthorized, userFromRequest } from "@/lib/server/billing";
import { cancelStripeSubscriptions } from "@/lib/server/stripe";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!billingEnabled()) return billingOff();
  const user = await userFromRequest(req);
  if (!user) return unauthorized();
  try {
    return Response.json({ user: { id: user.id, email: user.email }, entitlement: await entitlementOf(user) });
  } catch {
    return Response.json({ error: "server" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!billingEnabled()) return billingOff();
  const user = await userFromRequest(req);
  if (!user) return unauthorized();
  const row = await readRow(user.id);
  // A web subscription would keep charging after the account is gone; App Store subscriptions can
  // only be canceled by the user in their Apple settings (the client says so before deleting).
  if (row?.stripe_customer_id) await cancelStripeSubscriptions(row.stripe_customer_id);
  const token = req.headers.get("authorization")!.replace(/^Bearer\s+/i, "");
  await adminClient().auth.admin.signOut(token, "global").catch(() => undefined);
  const { error } = await adminClient().auth.admin.deleteUser(user.id);
  if (error) return Response.json({ error: "server" }, { status: 500 });
  return Response.json({ deleted: true });
}

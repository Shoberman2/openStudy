// A purchase or restore from the iPhone app (spec 11.5): the signed StoreKit 2 transaction is
// verified with Apple's certificates, tied to the signed-in account and stored.
import { appleRow, PLUS_PRODUCT_ID } from "@/engine/billing";
import { AppleEnvironmentError, BUNDLE_ID, verifyTransaction } from "@/lib/server/apple";
import { billingEnabled, billingOff, entitlementOf, unauthorized, userFromRequest, userIdBy, writeRow } from "@/lib/server/billing";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!billingEnabled()) return billingOff();
  const user = await userFromRequest(req);
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => null)) as { jws?: string } | null;
  if (!body?.jws) return Response.json({ error: "bad_request" }, { status: 400 });
  let tx;
  try {
    tx = await verifyTransaction(body.jws);
  } catch (e) {
    const reason = e instanceof AppleEnvironmentError ? "environment" : "unverified";
    return Response.json({ error: reason }, { status: 400 });
  }
  if (tx.bundleId !== BUNDLE_ID || tx.productId !== PLUS_PRODUCT_ID) return Response.json({ error: "wrong_product" }, { status: 400 });
  // The app sets appAccountToken to the account id at purchase, so a restore on another account
  // cannot claim someone else's subscription.
  if (tx.appAccountToken && tx.appAccountToken.toLowerCase() !== user.id.toLowerCase())
    return Response.json({ error: "other_account" }, { status: 409 });
  if (tx.originalTransactionId) {
    const owner = await userIdBy("original_transaction_id", tx.originalTransactionId);
    if (owner && owner !== user.id) return Response.json({ error: "other_account" }, { status: 409 });
  }
  await writeRow(appleRow(user.id, tx, null, null));
  return Response.json({ entitlement: await entitlementOf(user) });
}

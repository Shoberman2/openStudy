// App Store Server Notifications v2 (spec 11.5): renewals, expirations and refunds keep the
// entitlement current without the app being opened. Set this URL in App Store Connect.
import { appleRow } from "@/engine/billing";
import { verifyNotification } from "@/lib/server/apple";
import { billingEnabled, billingOff, userIdBy, writeRow } from "@/lib/server/billing";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!billingEnabled()) return billingOff();
  const body = (await req.json().catch(() => null)) as { signedPayload?: string } | null;
  if (!body?.signedPayload) return Response.json({ error: "bad_request" }, { status: 400 });
  let decoded;
  try {
    decoded = await verifyNotification(body.signedPayload);
  } catch {
    return Response.json({ error: "unverified" }, { status: 400 });
  }
  const { note, tx, renewal } = decoded;
  if (!tx) return Response.json({ ok: true }); // TEST and summary notifications carry no transaction
  const userId = tx.appAccountToken ?? (tx.originalTransactionId ? await userIdBy("original_transaction_id", tx.originalTransactionId) : null);
  // Unknown purchaser (bought before signing in and never restored): nothing to update yet.
  if (!userId) return Response.json({ ok: true });
  try {
    await writeRow(appleRow(userId, tx, renewal, note.notificationType ?? null));
  } catch (e) {
    // 23503: the account was deleted. Anything else is retried by Apple.
    if ((e as { code?: string }).code !== "23503") return Response.json({ error: "server" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

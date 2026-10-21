// Forgot password (spec 12.1): emails a recovery link through Resend. Always answers ok, so the
// answer never tells anyone whether an email has an account.
import { adminClient, billingEnabled, billingOff } from "@/lib/server/billing";
import { mailEnabled, resetEmail, sendMail, SITE } from "@/lib/server/mail";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!billingEnabled() || !mailEnabled()) return billingOff();
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email.trim())) return Response.json({ error: "email" }, { status: 400 });
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "recovery", email: email.trim() });
  const hash = data?.properties?.hashed_token;
  if (!error && hash) {
    const mail = resetEmail(`${SITE}/auth/reset?token_hash=${encodeURIComponent(hash)}`);
    await sendMail(email.trim(), mail.subject, mail.html, mail.text);
  }
  return Response.json({ ok: true });
}

// After sign-up (spec 12.1): sends the welcome email once per account and records the signup.
import { adminClient, billingEnabled, billingOff, unauthorized, userFromRequest } from "@/lib/server/billing";
import { sendMail, welcomeEmail } from "@/lib/server/mail";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!billingEnabled()) return billingOff();
  const user = await userFromRequest(req);
  if (!user) return unauthorized();
  if (user.app_metadata?.welcomed_at) return Response.json({ sent: false });
  // Mark first, so two quick calls never send two emails.
  await adminClient().auth.admin.updateUserById(user.id, { app_metadata: { ...user.app_metadata, welcomed_at: new Date().toISOString() } });
  const body = (await req.json().catch(() => ({}))) as { installId?: string; platform?: string };
  if (typeof body.installId === "string" && /^[0-9a-f-]{36}$/i.test(body.installId)) {
    await adminClient()
      .from("events")
      .insert({ t: new Date().toISOString(), install_id: body.installId, user_id: user.id, platform: body.platform === "ios" ? "ios" : "web", name: "signup", props: {} });
  }
  const mail = welcomeEmail();
  const sent = user.email ? await sendMail(user.email, mail.subject, mail.html, mail.text) : false;
  return Response.json({ sent });
}

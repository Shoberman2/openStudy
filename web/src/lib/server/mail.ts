import "server-only";
// Email through Resend (spec 12.2). Off until RESEND_API_KEY is set by the Vercel integration.

export const SITE = "https://openstudy-psi.vercel.app";

export const mailEnabled = () => !!process.env.RESEND_API_KEY;

function from(): string {
  const domain = process.env.OPENSTUDY_MAIL_DOMAIN;
  return domain ? `OpenStudy <hello@${domain}>` : "OpenStudy <onboarding@resend.dev>";
}

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!mailEnabled()) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: from(), to: [to], subject, html, text }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const shell = (body: string) => `<!doctype html><html><body style="margin:0;background:#f4f3ef;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1e">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<p style="font-size:15px;font-weight:800;color:#2e5ce6;margin:0 0 20px">OpenStudy</p>
${body}
</div></body></html>`;

const button = (href: string, label: string) =>
  `<p style="margin:28px 0"><a href="${href}" style="display:inline-block;background:#2e5ce6;color:#fff;font-weight:700;font-size:16px;text-decoration:none;padding:14px 22px;border-radius:12px">${label}</a></p>`;

export function welcomeEmail(): { subject: string; html: string; text: string } {
  const steps = [
    "Add your notes: book screenshots, class slides, PDFs, photos of the whiteboard.",
    "Sort them. OpenStudy groups pages into books and classes for you.",
    "Study a few minutes a day. Your plan brings back what you are about to forget.",
  ];
  const html = shell(`<h1 style="font-size:26px;line-height:1.2;margin:0 0 12px">Welcome to OpenStudy</h1>
<p style="font-size:17px;line-height:1.5;margin:0 0 20px">OpenStudy turns what you read and the notes you take into short lessons, then plans your study days until it sticks.</p>
<ol style="font-size:16px;line-height:1.5;padding-left:20px;margin:0">${steps.map((s) => `<li style="margin-bottom:8px">${s}</li>`).join("")}</ol>
<p style="font-size:16px;line-height:1.5;margin:20px 0 0">Lessons and your study plan come with OpenStudy Plus: 7 days free, then $10 a month.</p>
${button(`${SITE}/app`, "Open OpenStudy")}
<p style="font-size:13px;color:#6b6b70;margin:0">You got this email because you made an OpenStudy account.</p>`);
  const text = `Welcome to OpenStudy

OpenStudy turns what you read and the notes you take into short lessons, then plans your study days until it sticks.

${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Lessons and your study plan come with OpenStudy Plus: 7 days free, then $10 a month.

Open OpenStudy: ${SITE}/app`;
  return { subject: "Welcome to OpenStudy", html, text };
}

export function resetEmail(link: string): { subject: string; html: string; text: string } {
  const html = shell(`<h1 style="font-size:26px;line-height:1.2;margin:0 0 12px">Reset your password</h1>
<p style="font-size:17px;line-height:1.5;margin:0">Tap the button to choose a new password. The link works once, for one hour.</p>
${button(link, "Choose a new password")}
<p style="font-size:13px;color:#6b6b70;margin:0">If you did not ask for this, you can ignore this email.</p>`);
  return {
    subject: "Reset your OpenStudy password",
    html,
    text: `Choose a new OpenStudy password: ${link}\n\nThe link works once, for one hour. If you did not ask for this, ignore this email.`,
  };
}

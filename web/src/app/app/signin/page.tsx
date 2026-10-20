"use client";

// Sign in by email (spec 11.4): we send a sign-in link, and the code inside it works too.
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authConfigured, sendSignInEmail, verifyEmailCode } from "@/lib/auth";
import { BackHeader, Page } from "@/components/app/AppChrome";

function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next")?.startsWith("/app") ? params.get("next")! : "/app/profile";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter your email address.");
    setBusy(true);
    setError("");
    const err = await sendSignInEmail(email, next);
    setBusy(false);
    if (err) setError(err);
    else setSent(true);
  };

  const verify = async () => {
    setBusy(true);
    setError("");
    const err = await verifyEmailCode(email, code);
    setBusy(false);
    if (err) setError(err);
    else router.replace(next);
  };

  if (!authConfigured())
    return (
      <Page>
        <p className="text-[17px] text-muted">Accounts are not set up on this server yet.</p>
      </Page>
    );

  return (
    <Page>
      {!sent ? (
        <>
          <h2 className="text-[26px] font-black leading-tight">Sign in or create your account</h2>
          <p className="mt-2 text-[17px] text-muted">Your account holds your subscription. Your notes and lessons stay on this device.</p>
          <label className="mt-6 block">
            <span className="mb-2 block text-[15px] font-bold">Email</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void send()}
            />
          </label>
          {error && <p className="mt-3 text-[15px] font-semibold text-red">{error}</p>}
          <button className="btn btn-block mt-6" disabled={busy} onClick={() => void send()}>
            {busy ? "Sending..." : "Email me a sign-in link"}
          </button>
        </>
      ) : (
        <>
          <h2 className="text-[26px] font-black leading-tight">Check your email</h2>
          <p className="mt-2 text-[17px] text-muted">
            We sent a sign-in link to <strong className="text-ink">{email.trim()}</strong>. Open it in this browser. If the email has a 6-digit code, you can type it here instead.
          </p>
          <label className="mt-6 block">
            <span className="mb-2 block text-[15px] font-bold">Code</span>
            <input
              className="input tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && code.length >= 6 && void verify()}
            />
          </label>
          {error && <p className="mt-3 text-[15px] font-semibold text-red">{error}</p>}
          <button className="btn btn-block mt-6" disabled={busy || code.length < 6} onClick={() => void verify()}>
            {busy ? "Checking..." : "Sign in with code"}
          </button>
          <button className="btn btn-ghost btn-block mt-2" disabled={busy} onClick={() => void send()}>
            Send the email again
          </button>
          <button
            className="btn btn-ghost btn-block"
            onClick={() => {
              setSent(false);
              setCode("");
              setError("");
            }}
          >
            Use a different email
          </button>
        </>
      )}
    </Page>
  );
}

export default function SignInPage() {
  return (
    <>
      <BackHeader href="/app/profile" title="Account" />
      <Suspense>
        <SignIn />
      </Suspense>
    </>
  );
}

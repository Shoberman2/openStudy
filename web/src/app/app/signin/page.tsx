"use client";

// Email and password (spec 12.1): no codes and no emails to wait for.
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { logEvent } from "@/engine/library";
import { authConfigured, passwordAuth, requestPasswordReset, type AuthMode } from "@/lib/auth";
import { useAccount } from "@/lib/account";
import { useLibrary } from "@/lib/store";
import { BackHeader, Page } from "@/components/app/AppChrome";

function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next")?.startsWith("/app") ? params.get("next")! : "/app/profile";
  const { update } = useLibrary();
  const { reload } = useAccount();
  const [mode, setMode] = useState<AuthMode>("create");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const validEmail = () => /^\S+@\S+\.\S+$/.test(email.trim());

  const submit = async () => {
    if (!validEmail()) return setError("Enter your email address.");
    if (!password) return setError(mode === "create" ? "Use at least 8 characters." : "Enter your password.");
    setBusy(true);
    setError("");
    setNote("");
    const err = await passwordAuth(mode, email, password);
    setBusy(false);
    if (err) return setError(err);
    if (mode === "signin") update((l) => logEvent(l, "sign_in"));
    reload();
    router.replace(next);
  };

  const forgot = async () => {
    if (!validEmail()) return setError("Enter your email address first.");
    setBusy(true);
    setError("");
    const r = await requestPasswordReset(email);
    setBusy(false);
    if (r === "sent") setNote("If that email has an account, we sent a link to reset the password.");
    else if (r === "off") setError("Password reset by email is not set up yet. Write to support.");
    else setError("Could not reach OpenStudy. Check your connection.");
  };

  if (!authConfigured())
    return (
      <Page>
        <p className="text-[17px] text-muted">Accounts are not set up on this server yet.</p>
      </Page>
    );

  const creating = mode === "create";
  return (
    <Page>
      <h2 className="text-[26px] font-black leading-tight">{creating ? "Create your account" : "Sign in"}</h2>
      <p className="mt-2 text-[17px] text-muted">Your account holds your subscription. Your notes and lessons stay on this device.</p>
      <div className="mt-5 grid grid-cols-2 gap-1 rounded-2xl bg-shelf p-1" role="tablist">
        {(["create", "signin"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={`rounded-xl py-2.5 text-[15px] font-bold ${mode === m ? "bg-paper text-ink shadow-sm" : "text-muted"}`}
            onClick={() => {
              setMode(m);
              setError("");
              setNote("");
            }}
          >
            {m === "create" ? "Create account" : "Sign in"}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="mt-5 block">
          <span className="mb-2 block text-[15px] font-bold">Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="mt-4 block">
          <span className="mb-2 block text-[15px] font-bold">Password</span>
          <input
            className="input"
            type="password"
            autoComplete={creating ? "new-password" : "current-password"}
            placeholder={creating ? "At least 8 characters" : ""}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="mt-3 text-[15px] font-semibold text-red">{error}</p>}
        {note && <p className="mt-3 text-[15px] font-semibold text-ink">{note}</p>}
        <button type="submit" className="btn btn-block mt-6" disabled={busy}>
          {busy ? "One moment..." : creating ? "Create account" : "Sign in"}
        </button>
      </form>
      {!creating && (
        <button className="btn btn-ghost btn-block mt-2" disabled={busy} onClick={() => void forgot()}>
          Forgot password?
        </button>
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

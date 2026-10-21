"use client";

// Where the reset email lands (spec 12.1): choose a new password, then go into the app.
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { setNewPassword } from "@/lib/auth";

function Reset() {
  const router = useRouter();
  const token = useSearchParams().get("token_hash");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    const err = await setNewPassword(token, password);
    setBusy(false);
    if (err) setError(err);
    else router.replace("/app/profile");
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col justify-center px-4">
      {!token ? (
        <>
          <h1 className="text-[26px] font-black">That link did not work</h1>
          <p className="mt-2 text-[17px] text-muted">Ask for a new one from the sign-in screen.</p>
          <a className="btn btn-block mt-6" href="/app/signin">
            Go to sign in
          </a>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h1 className="text-[26px] font-black">Choose a new password</h1>
          <p className="mt-2 text-[17px] text-muted">Use it to sign in on the web and on your iPhone.</p>
          <label className="mt-6 block">
            <span className="mb-2 block text-[15px] font-bold">New password</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="mt-3 text-[15px] font-semibold text-red">{error}</p>}
          <button type="submit" className="btn btn-block mt-6" disabled={busy}>
            {busy ? "Saving..." : "Save password"}
          </button>
        </form>
      )}
    </main>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}

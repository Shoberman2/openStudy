"use client";

// Where the sign-in email link lands (spec 11.4): finish the PKCE exchange, then go back in.
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { exchangeSignInCode } from "@/lib/auth";

function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const code = params.get("code");
  const [exchangeFailed, setExchangeFailed] = useState(false);
  const failed = !code || exchangeFailed;
  useEffect(() => {
    if (!code) return;
    const next = params.get("next")?.startsWith("/app") ? params.get("next")! : "/app/profile";
    void exchangeSignInCode(code).then((ok) => (ok ? router.replace(next) : setExchangeFailed(true)));
  }, [code, params, router]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col justify-center px-4">
      {failed ? (
        <>
          <h1 className="text-[26px] font-black">That link did not work</h1>
          <p className="mt-2 text-[17px] text-muted">Links work once, in the browser you asked from. Ask for a new one.</p>
          <a className="btn btn-block mt-6" href="/app/signin">
            Get a new link
          </a>
        </>
      ) : (
        <p className="text-[17px] font-semibold text-muted">Signing you in...</p>
      )}
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <Callback />
    </Suspense>
  );
}

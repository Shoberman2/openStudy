"use client";

// Shows the paywall instead of a screen that needs OpenStudy Plus (spec 11.5: studying your own
// projects). Sample projects and a server without billing stay open.
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { needsPlus, useAccount } from "@/lib/account";
import { Loading, Page } from "./AppChrome";
import { Paywall } from "./Paywall";

export function PlusGate({ locked, from, children }: { locked: boolean; from: string; children: ReactNode }) {
  const { account } = useAccount();
  const router = useRouter();
  if (!locked) return <>{children}</>;
  if (!account) return <Loading />;
  if (!needsPlus(account)) return <>{children}</>;
  const here = typeof window === "undefined" ? "/app" : window.location.pathname + window.location.search;
  return (
    <Page>
      <Paywall from={from} returnTo={here} onClose={() => router.replace("/app")} />
    </Page>
  );
}

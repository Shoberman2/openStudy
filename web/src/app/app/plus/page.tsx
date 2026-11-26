"use client";

// OpenStudy Plus as a page (spec 11.5): the paywall's destination after sign-in, and a link target.
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Page } from "@/components/app/AppChrome";
import { Paywall } from "@/components/app/Paywall";
import { useAccount } from "@/lib/account";

function Plus() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next")?.startsWith("/app") ? params.get("next")! : "/app";
  const { account } = useAccount();
  if (account?.billing === "off")
    return (
      <Page>
        <p className="text-[17px] text-muted">Subscriptions are not available right now. Everything is unlocked.</p>
      </Page>
    );
  return (
    <Page>
      <Paywall from={params.get("from") ?? "link"} returnTo={next} onClose={() => router.replace(next)} />
    </Page>
  );
}

export default function PlusPage() {
  return (
    <Suspense>
      <Plus />
    </Suspense>
  );
}

"use client";

// OpenStudy Plus as a page (spec 11.5): the paywall's destination after sign-in, and a link target.
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Page } from "@/components/app/AppChrome";
import { Paywall } from "@/components/app/Paywall";

function Plus() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next")?.startsWith("/app") ? params.get("next")! : "/app";
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

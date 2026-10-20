import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/basics";

/** Support contact shown on the legal pages; set NEXT_PUBLIC_SUPPORT_EMAIL before launch. */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

export function Contact() {
  return SUPPORT_EMAIL ? (
    <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
      {SUPPORT_EMAIL}
    </a>
  ) : (
    <>the support contact on our App Store page</>
  );
}

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex h-[72px] w-full max-w-[720px] items-center px-4">
        <Logo />
      </header>
      <main className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-4 text-[17px] leading-[1.6] [&_h2]:mt-8 [&_h2]:text-[20px] [&_h2]:font-black [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
        <h1 className="text-[32px] font-black leading-tight">{title}</h1>
        <p className="text-[15px] text-muted">Last updated {updated}</p>
        {children}
        <p className="mt-10 text-[15px] text-muted">
          <Link className="underline" href="/terms">
            Terms
          </Link>
          {" · "}
          <Link className="underline" href="/privacy">
            Privacy
          </Link>
        </p>
      </main>
    </div>
  );
}

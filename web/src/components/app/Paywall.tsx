"use client";

// The OpenStudy Plus paywall (spec 11.5). Shown when someone creates a project or studies their
// own material without an active subscription. No urgency tricks: one price, one button.
import { Check, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logEvent } from "@/engine/library";
import { fetchMe, startCheckout } from "@/lib/auth";
import { useLibrary } from "@/lib/store";

export const PAYWALL_TITLE = "Keep everything you saved, and learn it.";
export const PAYWALL_LINES = ["All your projects and lessons", "Your study plan and practice tests", "Smart organize and Ask your notes"];
export const PAYWALL_PRICE = "7 days free, then $10 a month. Cancel anytime.";

const MESSAGES: Record<string, string> = {
  apple_subscriber: "You subscribe through the App Store. Manage it on your iPhone.",
  already_subscribed: "You already have OpenStudy Plus.",
  comp: "OpenStudy Plus is free for you.",
  off: "Subscriptions are not available yet.",
  failed: "We could not open checkout. Try again in a moment.",
};

export function Paywall({ from, onClose, returnTo }: { from: string; onClose: () => void; returnTo: string }) {
  const { update } = useLibrary();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    update((l) => logEvent(l, "paywall_view", { from }));
  }, [from, update]);

  const close = () => {
    update((l) => logEvent(l, "paywall_close", {}));
    onClose();
  };

  const start = async () => {
    setBusy(true);
    setMsg("");
    const me = await fetchMe();
    if (me.kind === "signed-out") {
      router.push(`/app/signin?next=${encodeURIComponent(`/app/plus?from=${from}&next=${encodeURIComponent(returnTo)}`)}`);
      return;
    }
    if (me.kind === "me" && me.me.entitlement.active) {
      setBusy(false);
      router.replace(returnTo);
      return;
    }
    const r = await startCheckout();
    if ("url" in r) {
      window.location.href = r.url;
      return;
    }
    setBusy(false);
    if (r.error === "signed-out") router.push(`/app/signin?next=${encodeURIComponent(`/app/plus?from=${from}`)}`);
    else setMsg(MESSAGES[r.error] ?? MESSAGES.failed);
  };

  return (
    <div className="relative">
      <button onClick={close} aria-label="Close" className="absolute -right-1 -top-1 rounded-full p-2 text-muted hover:bg-shelf">
        <X size={24} strokeWidth={2.75} />
      </button>
      <p className="kicker">OpenStudy Plus</p>
      <h2 className="mt-2 pr-10 text-[28px] font-black leading-[1.1]">{PAYWALL_TITLE}</h2>
      <ul className="mt-6 space-y-3">
        {PAYWALL_LINES.map((l) => (
          <li key={l} className="flex items-center gap-3 text-[17px] font-semibold">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-soft text-green">
              <Check size={18} strokeWidth={3} />
            </span>
            {l}
          </li>
        ))}
      </ul>
      <p className="mt-7 text-[17px] font-bold">{PAYWALL_PRICE}</p>
      {msg && <p className="mt-3 text-[15px] font-semibold text-red">{msg}</p>}
      <button className="btn btn-green btn-block mt-5" disabled={busy} onClick={() => void start()}>
        {busy ? "Opening checkout..." : "Start free trial"}
      </button>
      <Link className="btn btn-ghost btn-block mt-1" href={`/app/signin?next=${encodeURIComponent(returnTo)}`}>
        I already subscribe
      </Link>
      <p className="mt-4 text-center text-[13px] text-muted">
        <Link className="underline" href="/terms">
          Terms
        </Link>
        {" · "}
        <Link className="underline" href="/privacy">
          Privacy
        </Link>
      </p>
    </div>
  );
}

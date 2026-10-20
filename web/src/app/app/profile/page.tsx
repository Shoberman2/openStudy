"use client";

import { Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { logEvent } from "@/engine/library";
import { avatarInitial, profileStats, subscriptionLine } from "@/engine/profile";
import { billingPortal, deleteAccount, signOut } from "@/lib/auth";
import { useAccount } from "@/lib/account";
import { useLibrary } from "@/lib/store";
import { BackHeader, Loading, Page } from "@/components/app/AppChrome";

export default function ProfilePage() {
  const { lib, ready, update } = useLibrary();
  const { account, reload } = useAccount();
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const loggedStart = useRef(false);
  // Back from Stripe Checkout (spec 11.5): count the trial once, then drop the flag from the URL.
  useEffect(() => {
    if (!ready || loggedStart.current || new URLSearchParams(window.location.search).get("plus") !== "started") return;
    loggedStart.current = true;
    update((l) => logEvent(l, "trial_start", { source: "stripe" }));
    router.replace("/app/profile");
    reload();
  }, [ready, update, router, reload]);
  if (!ready || !account) return <Loading />;

  const manage = async () => {
    if (account.entitlement.source === "apple") return setMsg("You subscribe through the App Store. Manage it on your iPhone in Settings > Apple ID > Subscriptions.");
    setBusy(true);
    const url = await billingPortal();
    setBusy(false);
    if (url) window.location.href = url;
    else setMsg("We could not open billing right now. Try again in a moment.");
  };
  const doSignOut = async () => {
    await signOut();
    setMsg("");
    reload();
  };
  const doDelete = async () => {
    setBusy(true);
    const ok = await deleteAccount();
    setBusy(false);
    setConfirmDelete(false);
    setMsg(ok ? "Your account is deleted. Your library is still on this device." : "We could not delete your account. Try again.");
    reload();
  };

  const stats = profileStats(lib);
  const shownName = name ?? lib.profile.name ?? "";
  const initial = avatarInitial(shownName, account.email);
  const saveName = () => {
    if (name === null) return;
    const v = name.trim();
    update((l) => ({ ...l, profile: { ...l.profile, name: v || undefined } }));
    setName(null);
  };
  const since = stats.memberSince ? new Date(stats.memberSince).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;

  return (
    <>
      <BackHeader
        href="/app"
        title="Profile"
        right={
          <Link href="/app/settings" aria-label="Settings" className="-mr-1 rounded-full p-1.5 text-muted hover:bg-shelf">
            <Settings size={22} strokeWidth={2.5} />
          </Link>
        }
      />
      <Page>
        <section className="flex items-center gap-4">
          <div className="flex h-[72px] w-[72px] flex-none items-center justify-center rounded-full bg-blue text-[32px] font-black text-white" aria-hidden>
            {initial ?? <UserRound size={34} strokeWidth={2.5} />}
          </div>
          <div className="min-w-0 flex-1">
            <label className="kicker" htmlFor="profile-name">
              Your name
            </label>
            <input
              id="profile-name"
              className="input mt-1 !py-2.5"
              value={shownName}
              placeholder="What should we call you?"
              autoComplete="given-name"
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            {account.email && <p className="mt-1.5 truncate text-[14px] font-bold text-muted">{account.email}</p>}
            {since && <p className="mt-1 text-[14px] font-bold text-muted">Studying since {since}</p>}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-[20px] font-black">Your progress</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["Total XP", String(stats.xp)],
              ["Streak", `${stats.streak} day${stats.streak === 1 ? "" : "s"}`],
              ["Longest streak", `${stats.longestStreak} day${stats.longestStreak === 1 ? "" : "s"}`],
              ["Projects", String(stats.projects)],
              ["Cards learned", String(stats.cardsLearned)],
              ["Sessions", String(stats.sessions)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[16px] border-2 border-line p-4" style={{ boxShadow: "0 3px 0 var(--line)" }}>
                <p className="text-[13px] font-extrabold text-muted">{k}</p>
                <p className="mt-1 text-[22px] font-black">{v}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-9">
          <h2 className="mb-3 text-[20px] font-black">Subscription</h2>
          {account.billing === "off" ? (
            <p className="rounded-[16px] border-2 border-line p-4 font-semibold text-muted">Accounts and subscriptions are not set up on this server yet. Everything is unlocked.</p>
          ) : (
            <div className="rounded-[16px] border-2 border-line p-4">
              <p className="text-[18px] font-extrabold">{account.signedIn ? subscriptionLine(account.entitlement) : "Sign in to start your free trial or use your subscription."}</p>
              {account.offline && <p className="mt-1 text-[14px] font-bold text-muted">Offline. Showing your last known status.</p>}
              {msg && <p className="mt-2 text-[15px] font-semibold text-muted">{msg}</p>}
              <div className="mt-4 flex flex-col gap-1">
                {!account.signedIn ? (
                  <Link className="btn btn-block" href="/app/signin?next=/app/profile">
                    Sign in
                  </Link>
                ) : (
                  <>
                    {!account.entitlement.active && (
                      <Link className="btn btn-green btn-block" href="/app/plus?from=profile&next=/app/profile">
                        Start free trial
                      </Link>
                    )}
                    {account.entitlement.active && account.entitlement.source !== "comp" && (
                      <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => void manage()}>
                        Manage subscription
                      </button>
                    )}
                    <button className="btn btn-ghost btn-block" onClick={() => void doSignOut()}>
                      Sign out
                    </button>
                    {!confirmDelete ? (
                      <button className="btn btn-ghost btn-block !text-red" onClick={() => setConfirmDelete(true)}>
                        Delete account
                      </button>
                    ) : (
                      <div className="mt-2 rounded-[14px] bg-red-soft p-4">
                        <p className="text-[15px] font-semibold">
                          This deletes your account and cancels a web subscription. Your library stays on this device.
                          {account.entitlement.source === "apple" && " Cancel your App Store subscription in your iPhone's Settings too."}
                        </p>
                        <div className="mt-3 flex gap-2">
                          <button className="btn btn-red btn-sm" disabled={busy} onClick={() => void doDelete()}>
                            Delete
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>
                            Keep it
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </Page>
    </>
  );
}

"use client";

// The signed-in account and its subscription (spec 11.3 to 11.5). Every screen reads account
// state through this file. Billing is off when this server has no accounts configured: then
// everyone is signed out and nothing is locked.
import { useEffect, useState } from "react";
import type { Entitlement } from "@/engine/profile";
import { fetchMe } from "./auth";

export type AccountState = {
  /** "off": no accounts or payments configured on this server. */
  billing: "on" | "off";
  signedIn: boolean;
  userId?: string;
  email?: string;
  entitlement: Entitlement;
  /** The server could not be reached; the entitlement is the cached one (11.5 offline grace). */
  offline?: boolean;
};

export const BILLING_OFF: AccountState = { billing: "off", signedIn: false, entitlement: { active: true, status: "none" } };
const SIGNED_OUT: AccountState = { billing: "on", signedIn: false, entitlement: { active: false, status: "none" } };

export async function loadAccount(): Promise<AccountState> {
  const r = await fetchMe();
  if (r.kind === "off") return BILLING_OFF;
  if (r.kind === "signed-out") return SIGNED_OUT;
  return { billing: "on", signedIn: true, userId: r.me.userId, email: r.me.email, entitlement: r.me.entitlement, offline: r.offline };
}

/** Plus is needed for this action: billing is on and the account has no active subscription. */
export function needsPlus(account: AccountState | null): boolean {
  return !!account && account.billing === "on" && !account.entitlement.active;
}

export function useAccount(): { account: AccountState | null; reload: () => void } {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadAccount().then((a) => alive && setAccount(a));
    return () => {
      alive = false;
    };
  }, [n]);
  return { account, reload: () => setN((x) => x + 1) };
}

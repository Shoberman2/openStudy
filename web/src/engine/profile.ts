// Profile screen numbers and the subscription status line (spec 11.3). Pure.
import type { Library } from "./types";
import { displayStreak } from "./xp";

export type EntitlementStatus = "trialing" | "active" | "past_due" | "canceled" | "expired" | "comp" | "none";
export type Entitlement = {
  active: boolean;
  status: EntitlementStatus;
  source?: "apple" | "stripe" | "comp";
  renewsAt?: string;
  trialEndsAt?: string;
};

export type ProfileStats = {
  xp: number;
  streak: number;
  longestStreak: number;
  projects: number;
  cardsLearned: number;
  sessions: number;
  memberSince?: string;
};

export function profileStats(lib: Library, now: Date = new Date()): ProfileStats {
  const first = lib.events.map((e) => e.t).sort()[0];
  return {
    xp: lib.stats.xp,
    streak: displayStreak(lib.stats, now),
    longestStreak: lib.stats.longestStreak,
    projects: lib.projects.filter((p) => !p.sample).length,
    cardsLearned: lib.cards.filter((c) => c.srs.reps >= 1).length,
    sessions: lib.events.filter((e) => e.name === "session_done").length,
    memberSince: first,
  };
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "Free trial: 5 days left", "OpenStudy Plus, renews Nov 20", "Free for you" or "Not subscribed". */
export function subscriptionLine(e: Entitlement, now: Date = new Date()): string {
  if (e.status === "comp") return "Free for you";
  if (e.status === "trialing" && e.trialEndsAt) {
    const days = Math.max(0, Math.ceil((Date.parse(e.trialEndsAt) - now.getTime()) / 86_400_000));
    return `Free trial: ${days} day${days === 1 ? "" : "s"} left`;
  }
  if (e.status === "active") return e.renewsAt ? `OpenStudy Plus, renews ${shortDate(e.renewsAt)}` : "OpenStudy Plus";
  if (e.status === "past_due") return "OpenStudy Plus, payment needs attention";
  if (e.status === "canceled" && e.renewsAt && Date.parse(e.renewsAt) > now.getTime()) return `OpenStudy Plus until ${shortDate(e.renewsAt)}`;
  return "Not subscribed";
}

/** First letter of the name, else of the email, else null (show a person icon). */
export function avatarInitial(name?: string, email?: string): string | null {
  const src = name?.trim() || email?.trim();
  return src ? src[0].toUpperCase() : null;
}

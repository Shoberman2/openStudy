// XP, streak and daily goal (spec 5.5).
import type { Stats } from "./types";
import { dayDiff, localDay } from "./util";

export const XP = { correct: 1, lesson: 10, perfect: 5, apply: 3 } as const;

export function sessionXP(o: { correctFirst: number; applyCorrect: number; mistakes: number; completed: boolean }): number {
  let xp = o.correctFirst * XP.correct + o.applyCorrect * XP.apply;
  if (o.completed) {
    xp += XP.lesson;
    if (o.mistakes === 0) xp += XP.perfect;
  }
  return xp;
}

/** Apply streak rules for activity on `today` (call on XP gain). */
export function touchStreak(stats: Stats, today: string): Stats {
  const s = { ...stats, dayXP: { ...stats.dayXP } };
  const last = s.lastActiveDay;
  if (last === today) return s;
  let streak: number;
  let freezes = s.freezes;
  if (!last) streak = 1;
  else {
    const gap = dayDiff(last, today);
    if (gap === 1) streak = s.streak + 1;
    else if (gap === 2 && freezes > 0) {
      freezes -= 1;
      streak = s.streak + 1;
    } else if (gap <= 0) streak = Math.max(1, s.streak);
    else streak = 1;
  }
  if (streak > 0 && streak % 7 === 0 && streak !== s.streak) freezes = Math.min(2, freezes + 1);
  return {
    ...s,
    streak,
    freezes,
    longestStreak: Math.max(s.longestStreak, streak),
    lastActiveDay: today,
  };
}

export function addXP(stats: Stats, amount: number, now: Date = new Date()): Stats {
  if (amount <= 0) return stats;
  const today = localDay(now);
  const s = touchStreak(stats, today);
  return { ...s, xp: s.xp + amount, dayXP: { ...s.dayXP, [today]: (s.dayXP[today] ?? 0) + amount } };
}

/** Streak as displayed: 0 when the last active day is older than yesterday (and no freeze can cover it). */
export function displayStreak(stats: Stats, now: Date = new Date()): number {
  if (!stats.lastActiveDay) return 0;
  const gap = dayDiff(stats.lastActiveDay, localDay(now));
  if (gap <= 1) return stats.streak;
  if (gap === 2 && stats.freezes > 0) return stats.streak;
  return 0;
}

export function goalProgress(stats: Stats, dailyGoalXP: number, now: Date = new Date()): number {
  return Math.min(1, (stats.dayXP[localDay(now)] ?? 0) / dailyGoalXP);
}

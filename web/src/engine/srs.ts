// SM-2 variant (spec 5.4).
import type { Grade, Srs } from "./types";
import { addDays, clamp, startOfLocalDay } from "./util";

export function newSrs(now: Date = new Date()): Srs {
  return { state: "new", ease: 2.5, interval: 0, due: now.toISOString(), reps: 0, lapses: 0 };
}

export function review(srs: Srs, grade: Grade, now: Date = new Date()): Srs {
  if (grade === "again") {
    return {
      ...srs,
      lapses: srs.reps > 0 ? srs.lapses + 1 : srs.lapses,
      reps: 0,
      interval: 0,
      ease: Math.max(1.3, srs.ease - 0.2),
      state: "learning",
      due: new Date(now.getTime() + 10 * 60000).toISOString(),
    };
  }
  const reps = srs.reps + 1;
  const mult = grade === "hard" ? 0.8 : grade === "easy" ? 1.3 : 1;
  const interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(srs.interval * srs.ease * mult);
  const ease = clamp(srs.ease + (grade === "hard" ? -0.15 : grade === "easy" ? 0.15 : 0), 1.3, 3.0);
  return {
    ...srs,
    reps,
    interval,
    ease,
    state: "review",
    due: addDays(startOfLocalDay(now), interval).toISOString(),
  };
}

export function isDue(srs: Srs, now: Date = new Date()): boolean {
  return srs.state !== "new" && new Date(srs.due).getTime() <= now.getTime();
}

/** Map an answer outcome to an SRS grade (spec 5.4 mapping). */
export function gradeFor(
  verdict: "correct" | "close" | "wrong",
  opts: { fastTyped?: boolean; flash?: Grade } = {},
): Grade {
  if (opts.flash) return opts.flash;
  if (verdict === "wrong") return "again";
  if (verdict === "close") return "hard";
  return opts.fastTyped ? "easy" : "good";
}

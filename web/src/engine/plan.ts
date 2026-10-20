// Study plan (spec 8.6). Deterministic: recomputed from current state every time it is shown.
// Only completions are stored (as events); today's completed items are read back from them.
import { review } from "./srs";
import type { Card, Lesson, Library, Project } from "./types";
import { addDays, dayDiff, localDay } from "./util";

export const COST = { lesson: 4, quotes: 3, test: 8, reviewCard: 0.3 } as const;
export const GOAL_MINUTES: Record<number, number> = { 10: 5, 20: 10, 30: 15, 50: 20 };
export const READY_LEVEL = 3;
export const MASTERED_LEVEL = 5;
const REVIEW_SHARE = 0.4;
const MAX_DAYS = 90;

export type PlanItem =
  | { kind: "review"; minutes: number; cards: number; done?: boolean }
  | { kind: "lesson"; minutes: number; projectId: string; lessonId: string; title: string; projectTitle: string; weak?: boolean; done?: boolean }
  | { kind: "test"; minutes: number; projectId: string; projectTitle: string; done?: boolean };

export type PlanDay = { date: string; budget: number; used: number; items: PlanItem[]; goals: string[] };
export type Feasibility = { projectId: string; title: string; goalDate: string; neededMinutes: number };
export type Plan = { days: PlanDay[]; feasibility: Feasibility[] };

const shiftDay = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(addDays(new Date(y, m - 1, d), n));
};
const dayStart = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};
const lessonCost = (l: Lesson) => (l.kind === "quotes" ? COST.quotes : COST.lesson);

export function dailyMinutes(lib: Library): number {
  const base = GOAL_MINUTES[lib.profile.dailyGoalXP] ?? 10;
  const overrides = lib.projects.reduce((s, p) => s + (p.minutesPerDay ?? 0), 0);
  return Math.max(base, overrides);
}

/** Weak lessons from each project's latest practice test. */
export function weakLessons(lib: Library): Set<string> {
  const latest = new Map<string, string>();
  for (const e of lib.events) if (e.name === "test_done" && typeof e.props?.projectId === "string") latest.set(e.props.projectId, String(e.props.weakLessons ?? ""));
  return new Set([...latest.values()].flatMap((v) => v.split(",").filter(Boolean)));
}

type SimLesson = { l: Lesson; level: number; last?: string; weak: boolean };

export function buildPlan(lib: Library, now: Date = new Date()): Plan {
  const today = localDay(now);
  const budget = dailyMinutes(lib);
  const goals = lib.projects.filter((p) => p.goalDate && p.goalDate >= today);
  const latestGoal = goals.map((p) => p.goalDate!).sort().pop();
  const nDays = Math.min(MAX_DAYS, latestGoal ? dayDiff(today, latestGoal) + 1 : 7);
  const weak = weakLessons(lib);
  const projectById = new Map(lib.projects.map((p) => [p.id, p]));

  // Simulated state.
  const sim = new Map<string, SimLesson>(lib.lessons.map((l) => [l.id, { l, level: l.level, weak: weak.has(l.id) }]));
  const srs = new Map<string, Card["srs"]>(lib.cards.map((c) => [c.id, c.srs]));
  const dueDay = (c: Card) => localDay(new Date(srs.get(c.id)!.due));
  const reviewCard = (c: Card, day: string) => srs.set(c.id, review(srs.get(c.id)!, "good", dayStart(day)));

  // Today's completions (from events).
  const todayEvents = lib.events.filter((e) => localDay(new Date(e.t)) === today);
  const doneToday: PlanItem[] = [];
  const lessonsDoneToday = new Set<string>();
  const testsDoneToday = new Set<string>();
  let reviewMinutesDone = 0;
  for (const e of todayEvents) {
    if (e.name === "session_done" && typeof e.props?.lessonId === "string") {
      const s = sim.get(e.props.lessonId);
      if (!s || lessonsDoneToday.has(s.l.id)) continue;
      lessonsDoneToday.add(s.l.id);
      s.last = today;
      const p = projectById.get(s.l.projectId);
      doneToday.push({ kind: "lesson", minutes: lessonCost(s.l), projectId: s.l.projectId, lessonId: s.l.id, title: s.l.title, projectTitle: p?.title ?? "", done: true });
    } else if (e.name === "test_done" && typeof e.props?.projectId === "string") {
      testsDoneToday.add(e.props.projectId);
      doneToday.push({ kind: "test", minutes: COST.test, projectId: e.props.projectId, projectTitle: projectById.get(e.props.projectId)?.title ?? "", done: true });
    } else if (e.name === "review_done") {
      const n = Number(e.props?.count ?? 0);
      reviewMinutesDone += n * COST.reviewCard;
      doneToday.push({ kind: "review", minutes: Math.max(1, Math.round(n * COST.reviewCard)), cards: n, done: true });
    }
  }

  const unlocked = (s: SimLesson) => {
    if (s.l.kind === "quotes") return true;
    const prev = lib.lessons
      .filter((x) => x.projectId === s.l.projectId && x.kind === "theme" && x.order < s.l.order)
      .sort((a, b) => b.order - a.order)[0];
    return !prev || (sim.get(prev.id)?.level ?? 0) >= 1;
  };

  const days: PlanDay[] = [];
  const readyBy = new Map<string, boolean>(); // projectId -> all lessons ready by goal-1
  for (let i = 0; i < nDays; i++) {
    const d = shiftDay(today, i);
    const isToday = i === 0;
    const items: PlanItem[] = isToday ? [...doneToday] : [];
    let used = isToday ? doneToday.reduce((s, x) => s + x.minutes, 0) : 0;
    const scheduledToday = new Set<string>(isToday ? lessonsDoneToday : []);

    // 1. Reviews first, capped at 40% of the day's minutes; overflow rolls to the next day.
    const reviewCap = Math.max(0, Math.floor((budget * REVIEW_SHARE - (isToday ? reviewMinutesDone : 0)) / COST.reviewCard));
    const due = lib.cards.filter((c) => srs.get(c.id)!.state !== "new" && dueDay(c) <= d).sort((a, b) => srs.get(a.id)!.due.localeCompare(srs.get(b.id)!.due));
    const n = Math.min(due.length, reviewCap);
    if (n > 0) {
      due.slice(0, n).forEach((c) => reviewCard(c, d));
      const minutes = n * COST.reviewCard;
      used += minutes;
      items.push({ kind: "review", minutes: Math.max(1, Math.round(minutes)), cards: n });
    }

    // 2. Practice tests on goal-1, goal-3 and goal-7.
    for (const p of goals) {
      const toGoal = dayDiff(d, p.goalDate!);
      if ((toGoal === 1 || toGoal === 3 || toGoal === 7) && !(isToday && testsDoneToday.has(p.id))) {
        items.push({ kind: "test", minutes: COST.test, projectId: p.id, projectTitle: p.title });
        used += COST.test;
      }
    }

    // 3. New learning and strengthening, round robin across projects.
    const rotation: Project[] = [];
    const ordered = lib.projects.slice().sort((a, b) => (a.goalDate ?? "9999").localeCompare(b.goalDate ?? "9999") || a.createdAt.localeCompare(b.createdAt));
    for (const p of ordered) {
      rotation.push(p);
      const g = p.goalDate ? dayDiff(d, p.goalDate) : -1;
      if (g >= 0 && g <= 14) rotation.push(p);
    }
    let lessonsToday = items.filter((x) => x.kind === "lesson").length;
    for (let progress = true; progress; ) {
      progress = false;
      for (const p of rotation) {
        const toGoal = p.goalDate ? dayDiff(d, p.goalDate) : Infinity;
        const tight = toGoal >= 0 && toGoal <= 2;
        const cands = [...sim.values()]
          .filter((s) => s.l.projectId === p.id && (s.level < READY_LEVEL || s.weak) && s.level < MASTERED_LEVEL)
          .filter((s) => !scheduledToday.has(s.l.id) && unlocked(s))
          .filter((s) => !s.last || dayDiff(s.last, d) >= (tight ? 1 : 2))
          .sort((a, b) => Number(b.weak) - Number(a.weak) || a.l.order - b.l.order);
        const s = cands[0];
        if (!s) continue;
        const cost = lessonCost(s.l);
        const fits = used + cost <= budget + 1e-9 || (lessonsToday === 0 && used < budget);
        if (!fits) continue;
        items.push({ kind: "lesson", minutes: cost, projectId: p.id, lessonId: s.l.id, title: s.l.title, projectTitle: p.title, weak: s.weak || undefined });
        used += cost;
        lessonsToday++;
        scheduledToday.add(s.l.id);
        s.level = Math.min(MASTERED_LEVEL, s.level + 1);
        s.last = d;
        s.weak = false;
        lib.cards.filter((c) => c.lessonId === s.l.id && srs.get(c.id)!.state === "new").forEach((c) => reviewCard(c, d));
        progress = true;
      }
    }

    for (const p of goals) {
      if (dayDiff(d, p.goalDate!) === 1 || (dayDiff(today, p.goalDate!) <= 1 && isToday)) {
        readyBy.set(p.id, [...sim.values()].filter((s) => s.l.projectId === p.id).every((s) => s.level >= READY_LEVEL));
      }
    }
    days.push({ date: d, budget, used, items, goals: goals.filter((p) => p.goalDate === d).map((p) => p.id) });
  }

  // Feasibility: can every lesson reach ready by goal-1 at the current daily minutes?
  const feasibility: Feasibility[] = [];
  for (const p of goals) {
    if (readyBy.get(p.id) !== false) continue;
    const lessons = lib.lessons.filter((l) => l.projectId === p.id);
    const sessionMinutes = lessons.reduce((s, l) => s + Math.max(0, READY_LEVEL - l.level) * lessonCost(l), 0);
    const daysLeft = Math.max(1, dayDiff(today, p.goalDate!));
    // Lesson time per day, plus room for the review share.
    const needed = Math.ceil((sessionMinutes / daysLeft / (1 - REVIEW_SHARE)) / 5) * 5;
    if (needed > budget) feasibility.push({ projectId: p.id, title: p.title, goalDate: p.goalDate!, neededMinutes: needed });
  }
  return { days, feasibility };
}

/** Human date label: "Today", "Tomorrow", "Thu, Oct 22". */
export function dayLabel(day: string, now: Date = new Date()): string {
  const diff = dayDiff(localDay(now), day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return dayStart(day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function lessonReady(l: Lesson): boolean {
  return l.level >= READY_LEVEL;
}

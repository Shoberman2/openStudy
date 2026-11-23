import { describe, expect, it } from "vitest";
import { emptyLibrary, currentLesson, projectLessons, unlockedIds } from "./library";
import { buildPlan, readyLessonCount } from "./plan";
import type { Lesson, Project } from "./types";
import { addDays, dayDiff, localDay } from "./util";

const now = new Date(2026, 10, 23, 10);
const profile = emptyLibrary().profile;
const lesson: Lesson = { id: "l1", projectId: "p", title: "Vectors", summary: "", kind: "theme", order: 0, level: 0, sessions: 0 };
const project: Project = { id: "p", color: "blue", title: "R", createdAt: now.toISOString(), focus: "ideas", quotesAsked: true, type: "class" };

describe("open lessons and plans", () => {
  const lessons = [lesson, { ...lesson, id: "l2", order: 1 }, { ...lesson, id: "l3", order: 2, kind: "quotes" as const }];
  it("opens every lesson and picks one next up", () => {
    const ordered = projectLessons({ ...emptyLibrary(), lessons }, project.id);
    expect([...unlockedIds(ordered)]).toEqual(["l1", "l2", "l3"]);
    expect(currentLesson(ordered)?.id).toBe("l1");
    expect(currentLesson([{ ...lesson, level: 1 }, ...ordered.slice(1)])?.id).toBe("l2");
    expect(currentLesson([])).toBeUndefined();
  });

  it("schedules work without requiring an earlier lesson to unlock it", () => {
    const lib = { ...emptyLibrary(), projects: [project], lessons, events: [
      { t: now.toISOString(), name: "test_done", props: { projectId: project.id, weakLessons: "l2" } },
    ] };
    expect(buildPlan(lib, now).days[0].items.find((i) => i.kind === "lesson")).toMatchObject({ lessonId: "l2", weak: true });
  });

  it("keeps all exam tests, including when today's budget is already spent", () => {
    const goalDate = localDay(addDays(now, 7));
    const lib = {
      ...emptyLibrary(), profile: { ...profile, dailyGoalXP: 10 as const }, projects: [{ ...project, goalDate }],
      lessons: lessons.slice(0, 2).map((l) => ({ ...l, level: 3 })),
      events: [{ t: now.toISOString(), name: "review_done", props: { count: 20 } }],
    };
    expect(readyLessonCount(lib.lessons)).toBe(2);
    const days = buildPlan(lib, now).days;
    const tests = days.filter((day) => day.items.some((i) => i.kind === "test"));
    expect(tests.map((day) => dayDiff(day.date, goalDate))).toEqual([7, 3, 1]);
    expect(tests.map((day) => [day.used, day.overBy])).toEqual([[14, 9], [8, 3], [8, 3]]);
    expect(days[1]).not.toHaveProperty("overBy");
    expect(buildPlan({ ...lib, lessons: lib.lessons.slice(0, 1) }, now).days.every((d) => d.items.every((i) => i.kind !== "test"))).toBe(true);
  });
});

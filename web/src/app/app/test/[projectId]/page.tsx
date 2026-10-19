"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Exercise } from "@/engine/exercises";
import { logEvent } from "@/engine/library";
import { buildFromCards, buildPracticeTest, scoreTest, type TestResult } from "@/engine/session";
import type { Grade } from "@/engine/types";
import { applyGrades, finishPractice } from "@/lib/actions";
import { useLibrary } from "@/lib/store";
import { Loading } from "@/components/app/AppChrome";
import { Ring } from "@/components/ui/basics";
import { SessionPlayer, type SessionSummary } from "@/components/exercise/SessionPlayer";
import { TestPlayer, type TestAnswer } from "@/components/exercise/TestPlayer";
import { SessionComplete } from "@/components/exercise/SessionComplete";
import { localDay } from "@/engine/util";
import { addXP, displayStreak } from "@/engine/xp";

export default function TestPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { lib, ready, update } = useLibrary();
  const router = useRouter();
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [review, setReview] = useState<Exercise[] | null>(null);
  const built = useRef(false);
  const project = lib.projects.find((p) => p.id === projectId);

  useEffect(() => {
    if (!ready || built.current || !project) return;
    built.current = true;
    const lessons = lib.lessons.filter((l) => l.projectId === project.id);
    setExercises(buildPracticeTest(lessons, lib.cards.filter((c) => c.projectId === project.id)));
  }, [ready, project, lib.lessons, lib.cards]);

  const onDone = useCallback(
    (answers: TestAnswer[]) => {
      const cards = lib.cards.filter((c) => c.projectId === projectId);
      const r = scoreTest(answers, cards);
      const grades: Record<string, Grade> = {};
      for (const a of answers) for (const id of a.ex.cardIds) grades[id] ??= a.grade;
      update((l) => {
        let next = applyGrades(l, grades);
        next = { ...next, stats: addXP(next.stats, r.correct + 10) };
        return logEvent(next, "test_done", { projectId, accuracy: Math.round(r.accuracy * 100) / 100, weakLessons: r.weakLessons.join(","), questions: r.total });
      });
      setResult(r);
    },
    [lib.cards, projectId, update],
  );

  const [reviewDone, setReviewDone] = useState<{ xp: number; s: SessionSummary } | null>(null);
  const onReviewDone = useCallback(
    (s: SessionSummary) => {
      let xp = 0;
      update((l) => {
        const r = finishPractice(l, s, review?.length ?? 0);
        xp = r.xp;
        return r.lib;
      });
      setReviewDone({ xp, s });
    },
    [update, review],
  );
  const onGraded = useCallback((g: Record<string, Grade>) => update((l) => applyGrades(l, g)), [update]);

  if (!ready) return <Loading />;
  if (!project)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="font-bold text-muted">This project is not on your shelf.</p>
        <Link href="/app" className="btn">
          Home
        </Link>
      </div>
    );
  if (reviewDone) {
    const now = new Date();
    return (
      <SessionComplete
        title="Misses reviewed"
        xp={reviewDone.xp}
        accuracy={reviewDone.s.accuracy}
        seconds={reviewDone.s.seconds}
        streak={displayStreak(lib.stats, now)}
        goal={{ today: lib.stats.dayXP[localDay(now)] ?? 0, target: lib.profile.dailyGoalXP }}
        onContinue={() => router.push(`/app/p/${project.id}`)}
      />
    );
  }
  if (review) return <SessionPlayer exercises={review} onGraded={onGraded} onFinish={onReviewDone} onClose={() => router.push(`/app/p/${project.id}`)} />;
  if (result) {
    const titleOf = (id: string) => lib.lessons.find((l) => l.id === id)?.title ?? "Lesson";
    const orderOf = (id: string) => lib.lessons.find((l) => l.id === id)?.order ?? 0;
    const missed = lib.cards.filter((c) => result.missedCardIds.includes(c.id));
    return (
      <div className="flex min-h-dvh flex-col">
        <main className="anim-fade mx-auto w-full max-w-[640px] flex-1 px-4 pb-44 pt-12 sm:pt-16">
          <div className="flex flex-col items-center text-center">
            <Ring value={result.accuracy} size={132} stroke={14} color={result.accuracy >= 0.7 ? "var(--green)" : "var(--red)"}>
              <div>
                <div className="text-[32px] font-black leading-none">{Math.round(result.accuracy * 100)}%</div>
                <div className="mt-1 text-[13px] font-extrabold text-muted">
                  {result.correct} of {result.total}
                </div>
              </div>
            </Ring>
            <h1 className="mt-6 text-[28px] font-black leading-tight tracking-tight">Practice test done</h1>
            <p className="mt-1 text-muted">{project.title}</p>
          </div>
          <section className="card mt-8 p-5" aria-label="Accuracy by lesson">
            <h2 className="mb-3 font-black">By lesson</h2>
            <ul className="grid grid-cols-1 gap-3.5">
              {result.perLesson
                .slice()
                .sort((a, b) => orderOf(a.lessonId) - orderOf(b.lessonId))
                .map((l) => (
                  <li key={l.lessonId}>
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="truncate font-bold">{titleOf(l.lessonId)}</span>
                      <span className={`flex-none text-[14px] font-extrabold ${l.accuracy >= 0.7 ? "text-green" : "text-red"}`}>
                        {l.correct} of {l.total}
                      </span>
                    </div>
                    <div className="progress !h-3">
                      <span style={{ width: `${Math.max(4, l.accuracy * 100)}%`, ["--fill" as string]: l.accuracy >= 0.7 ? "var(--green)" : "var(--red)" }} />
                    </div>
                  </li>
                ))}
            </ul>
            {result.weakLessons.length > 0 && (
              <p className="mt-4 text-[14px] font-bold text-muted">Lessons under 70% move to the front of your plan.</p>
            )}
          </section>
        </main>
        <div className="fixed inset-x-0 bottom-0 border-t-2 border-line bg-paper">
          <div className="mx-auto flex w-full max-w-[640px] flex-col-reverse gap-3 px-4 py-4 sm:flex-row sm:justify-end sm:py-6">
            <Link href={`/app/p/${project.id}`} className="btn btn-secondary sm:min-w-[160px]">
              Back to project
            </Link>
            {missed.length > 0 && (
              <button className="btn sm:min-w-[200px]" onClick={() => setReview(buildFromCards(missed, lib.cards.filter((c) => c.projectId === project.id)))}>
                Review your misses
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
  if (!exercises) return <Loading />;
  if (!exercises.length)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="font-bold text-muted">No cards to test yet.</p>
        <Link href={`/app/p/${project.id}`} className="btn">
          Back
        </Link>
      </div>
    );
  return <TestPlayer exercises={exercises} title={project.title} onDone={onDone} onClose={() => router.push(`/app/p/${project.id}`)} />;
}

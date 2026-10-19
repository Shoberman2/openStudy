"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Exercise } from "@/engine/exercises";
import { logEvent } from "@/engine/library";
import { buildSession } from "@/engine/session";
import type { Grade } from "@/engine/types";
import { localDay } from "@/engine/util";
import { displayStreak } from "@/engine/xp";
import { applyGrades, finishLesson } from "@/lib/actions";
import { useLibrary } from "@/lib/store";
import { Loading } from "@/components/app/AppChrome";
import { SessionPlayer, type SessionSummary, type Source } from "@/components/exercise/SessionPlayer";
import { SessionComplete } from "@/components/exercise/SessionComplete";

export default function LearnPage() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const { lib, ready, update } = useLibrary();
  const router = useRouter();
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [done, setDone] = useState<{ xp: number; s: SessionSummary } | null>(null);
  const built = useRef(false);
  const lesson = lib.lessons.find((l) => l.id === lessonId);
  const project = lesson ? lib.projects.find((p) => p.id === lesson.projectId) : undefined;

  useEffect(() => {
    if (!ready || built.current || !lesson) return;
    built.current = true;
    const projectType = lib.projects.find((p) => p.id === lesson.projectId)?.type;
    const ex = buildSession(lesson, lib.cards, lib.profile, new Date(), Math.random, lib.cards.filter((c) => c.projectId === lesson.projectId), { projectType });
    setExercises(ex);
    update((l) => logEvent(l, "session_start", { lessonKind: lesson.kind, level: lesson.level, projectId: lesson.projectId, lessonId: lesson.id }));
  }, [ready, lesson, lib.cards, lib.profile, lib.projects, update]);

  const sourceFor = useCallback(
    (ex: Exercise): Source | null => {
      const card = lib.cards.find((c) => c.id === ex.cardIds[0]);
      const page = card?.pageId ? lib.pages.find((p) => p.id === card.pageId) : undefined;
      if (!project) return null;
      return { book: project.title, header: page?.header, text: page?.text ?? card?.statement };
    },
    [lib.cards, lib.pages, project],
  );

  const onGraded = useCallback((g: Record<string, Grade>) => update((l) => applyGrades(l, g)), [update]);
  const onFinish = useCallback(
    (s: SessionSummary) => {
      let xp = 0;
      update((l) => {
        const r = finishLesson(l, lessonId, s);
        xp = r.xp;
        return r.lib;
      });
      setDone({ xp, s });
    },
    [update, lessonId],
  );

  if (!ready) return <Loading />;
  if (!lesson || !project)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="font-bold text-muted">This lesson does not exist anymore.</p>
        <Link href="/app" className="btn">
          Home
        </Link>
      </div>
    );
  if (done) {
    const now = new Date();
    return (
      <SessionComplete
        title={`${lesson.title} done`}
        xp={done.xp}
        accuracy={done.s.accuracy}
        seconds={done.s.seconds}
        streak={displayStreak(lib.stats, now)}
        level={lesson.level}
        goal={{ today: lib.stats.dayXP[localDay(now)] ?? 0, target: lib.profile.dailyGoalXP }}
        onContinue={() => router.push(`/app/p/${project.id}`)}
      />
    );
  }
  if (!exercises) return <Loading />;
  if (!exercises.length)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="font-bold text-muted">No cards in this lesson yet.</p>
        <Link href={`/app/p/${project.id}`} className="btn">
          Back to the path
        </Link>
      </div>
    );
  return <SessionPlayer exercises={exercises} sourceFor={sourceFor} onGraded={onGraded} onFinish={onFinish} onClose={() => router.push(`/app/p/${project.id}`)} />;
}

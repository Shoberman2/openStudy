"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Exercise } from "@/engine/exercises";
import { logEvent } from "@/engine/library";
import { buildSession, conceptExercises } from "@/engine/session";
import type { Card, Grade } from "@/engine/types";
import { applyWrittenConcepts, needsWrittenConcepts, writerInput } from "@/engine/written";
import { localDay } from "@/engine/util";
import { displayStreak } from "@/engine/xp";
import { applyGrades, finishLesson } from "@/lib/actions";
import { writeConcepts } from "@/lib/ai";
import { useLibrary } from "@/lib/store";
import { PlusGate } from "@/components/app/PlusGate";
import { Loading } from "@/components/app/AppChrome";
import { SessionPlayer, type SessionSummary, type Source } from "@/components/exercise/SessionPlayer";
import { SessionComplete } from "@/components/exercise/SessionComplete";

function LearnPageSession() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const { lib, ready, update } = useLibrary();
  const router = useRouter();
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [done, setDone] = useState<{ xp: number; s: SessionSummary } | null>(null);
  const built = useRef(false);
  const lesson = lib.lessons.find((l) => l.id === lessonId);
  const project = lesson ? lib.projects.find((p) => p.id === lesson.projectId) : undefined;

  useEffect(() => {
    if (!ready || built.current || !lesson || !project) return;
    built.current = true;
    const start = (cards: Card[]) => {
      const ex = buildSession(lesson, cards, lib.profile, new Date(), Math.random, cards.filter((c) => c.projectId === lesson.projectId), { projectType: project.type });
      setExercises(ex);
      update((l) => logEvent(l, "session_start", { lessonKind: lesson.kind, level: lesson.level, concepts: conceptExercises(ex, cards), projectId: lesson.projectId, lessonId: lesson.id }));
    };
    if (!needsWrittenConcepts(lib, lesson.id)) return start(lib.cards);
    // Spec 13.6: a model rewrites the lesson as questions about ideas the first time it is opened.
    void writeConcepts({ title: lesson.title }, { title: project.title, type: project.type }, writerInput(lib, lesson.id)).then((written) => {
      let cards = lib.cards;
      update((l) => {
        const next = applyWrittenConcepts(l, lesson.id, written ?? [], written ? "server" : "none");
        cards = next.cards;
        return next;
      });
      start(cards);
    });
  }, [ready, lesson, project, lib, update]);

  const sourceFor = useCallback(
    (ex: Exercise): Source | null => {
      const card = lib.cards.find((c) => c.id === ex.cardIds[0]);
      const page = card?.pageId ? lib.pages.find((p) => p.id === card.pageId) : undefined;
      if (!project) return null;
      return { book: project.title, header: page?.header, text: page?.text ?? card?.statement, image: page?.image, pageNumber: page?.pageNumber };
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
  // Shown until the writer is done: applying its result marks the lesson as written (spec 13.6).
  if (!exercises && needsWrittenConcepts(lib, lesson.id))
    return (
      <div className="flex min-h-dvh items-center justify-center gap-3 p-6 font-bold text-muted" aria-busy="true">
        <LoaderCircle className="animate-spin" size={22} /> Writing questions for {lesson.title}
      </div>
    );
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

/** Studying your own projects needs OpenStudy Plus (spec 11.5); sample projects stay open. */
export default function LearnPage() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const { lib, ready } = useLibrary();
  if (!ready) return <Loading />;
  const lesson = lib.lessons.find((l) => l.id === lessonId);
  const project = lesson ? lib.projects.find((p) => p.id === lesson.projectId) : undefined;
  return (
    <PlusGate locked={!!project && !project.sample} from="lesson">
      <LearnPageSession />
    </PlusGate>
  );
}

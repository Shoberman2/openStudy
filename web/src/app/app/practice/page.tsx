"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Exercise } from "@/engine/exercises";
import { buildConnection, buildPractice, nextDueDate } from "@/engine/session";
import type { Grade } from "@/engine/types";
import { localDay, relativeTime } from "@/engine/util";
import { displayStreak } from "@/engine/xp";
import { applyGrades, finishPractice } from "@/lib/actions";
import { useLibrary } from "@/lib/store";
import { PlusGate } from "@/components/app/PlusGate";
import { BackHeader, Loading, Page } from "@/components/app/AppChrome";
import { SessionPlayer, type SessionSummary, type Source } from "@/components/exercise/SessionPlayer";
import { SessionComplete } from "@/components/exercise/SessionComplete";

function PracticePageSession() {
  const { lib, ready, update } = useLibrary();
  const router = useRouter();
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [done, setDone] = useState<{ xp: number; s: SessionSummary } | null>(null);
  const built = useRef(false);

  useEffect(() => {
    if (!ready || built.current) return;
    built.current = true;
    // "Practice both" from a connection on Home (spec 10.8).
    const q = new URLSearchParams(window.location.search);
    const a = q.get("a");
    const b = q.get("b");
    setExercises(a && b ? buildConnection(a, b, lib.cards, new Date()) : buildPractice(lib.cards, new Date()));
  }, [ready, lib.cards]);

  const sourceFor = useCallback(
    (ex: Exercise): Source | null => {
      const card = lib.cards.find((c) => c.id === ex.cardIds[0]);
      const project = lib.projects.find((p) => p.id === ex.projectId);
      const page = card?.pageId ? lib.pages.find((p) => p.id === card.pageId) : undefined;
      return project ? { book: project.title, header: page?.header, text: page?.text ?? card?.statement, image: page?.image, pageNumber: page?.pageNumber } : null;
    },
    [lib.cards, lib.pages, lib.projects],
  );
  const onGraded = useCallback((g: Record<string, Grade>) => update((l) => applyGrades(l, g)), [update]);
  const onFinish = useCallback(
    (s: SessionSummary) => {
      let xp = 0;
      const count = new Set(exercises?.flatMap((e) => e.cardIds)).size;
      update((l) => {
        const r = finishPractice(l, s, count);
        xp = r.xp;
        return r.lib;
      });
      setDone({ xp, s });
    },
    [update, exercises],
  );

  if (!ready || !exercises) return <Loading />;
  if (done) {
    const now = new Date();
    return (
      <SessionComplete
        title="Review done"
        xp={done.xp}
        accuracy={done.s.accuracy}
        seconds={done.s.seconds}
        streak={displayStreak(lib.stats, now)}
        goal={{ today: lib.stats.dayXP[localDay(now)] ?? 0, target: lib.profile.dailyGoalXP }}
        onContinue={() => router.push("/app")}
      />
    );
  }
  if (!exercises.length) {
    const next = nextDueDate(lib.cards);
    return (
      <>
        <BackHeader href="/app" title="Practice" />
        <Page>
          <div className="py-14 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-soft text-blue">
              <RefreshCw size={30} strokeWidth={2.75} />
            </span>
            <h1 className="mt-5 text-[26px] font-black">Nothing due.</h1>
            <p className="mt-1 text-muted">{next ? `Your next review is ${relativeTime(next)}.` : "Finish a lesson and its cards come back here for review."}</p>
            <Link href="/app" className="btn mt-7">
              Back home
            </Link>
          </div>
        </Page>
      </>
    );
  }
  return <SessionPlayer exercises={exercises} sourceFor={sourceFor} onGraded={onGraded} onFinish={onFinish} onClose={() => router.push("/app")} />;
}

/** Review mixes cards from every project, so it needs OpenStudy Plus once you have your own (spec 11.5). */
export default function PracticePage() {
  const { lib, ready } = useLibrary();
  if (!ready) return <Loading />;
  return (
    <PlusGate locked={lib.projects.some((p) => !p.sample)} from="practice">
      <PracticePageSession />
    </PlusGate>
  );
}

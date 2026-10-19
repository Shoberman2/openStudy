"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Verdict } from "@/engine/check";
import { checkAnswer, type Answer, type Exercise } from "@/engine/exercises";
import type { Grade } from "@/engine/types";
import { ProgressBar } from "@/components/ui/basics";
import { ExerciseView, instructionFor } from "./ExerciseView";

export type TestAnswer = { ex: Exercise; verdict: Verdict; grade: Grade };

/** Practice test: no feedback until the end, no re-queue (spec 8.6). */
export function TestPlayer({ exercises, title, onDone, onClose }: { exercises: Exercise[]; title: string; onDone: (a: TestAnswer[]) => void; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [answers, setAnswers] = useState<TestAnswer[]>([]);
  const ex = exercises[i];
  const last = i === exercises.length - 1;

  const next = useCallback(
    (a?: Answer) => {
      const ans = a ?? answer;
      if (!ex || !ans) return;
      const r = checkAnswer(ex, ans);
      const all = [...answers, { ex, verdict: r.verdict, grade: r.grade }];
      setAnswers(all);
      setAnswer(null);
      if (last) onDone(all);
      else setI(i + 1);
    },
    [answer, answers, ex, i, last, onDone],
  );

  // Opt-in hook for automated browser tests (localStorage "os-debug" = "1").
  useEffect(() => {
    try {
      if (localStorage.getItem("os-debug") === "1") (window as unknown as { __osEx?: Exercise }).__osEx = ex;
    } catch {
      /* ignore */
    }
  }, [ex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && answer && (e.target as HTMLElement)?.tagName !== "TEXTAREA") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, next]);

  if (!ex) return null;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 bg-paper">
        <div className="mx-auto flex w-full max-w-[640px] items-center gap-3 px-4 py-4">
          <button onClick={onClose} aria-label="Leave test" className="-ml-1 rounded-full p-1.5 text-muted hover:bg-shelf">
            <X size={26} strokeWidth={2.75} />
          </button>
          <div className="flex-1">
            <ProgressBar value={i / exercises.length} label="Test progress" />
          </div>
          <span className="w-[64px] text-right text-[14px] font-extrabold text-muted">
            {i + 1} of {exercises.length}
          </span>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[640px] px-4 pb-48 pt-6 sm:pt-10">
        <p className="kicker mb-1">Practice test: {title}</p>
        <p className="kicker mb-3 !text-ink">{instructionFor(ex)}</p>
        <ExerciseView key={ex.id} ex={ex} result={null} onAnswer={setAnswer} onSubmit={(a) => next(a)} />
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-line bg-paper">
        <div className="mx-auto flex w-full max-w-[640px] items-center justify-between gap-3 px-4 py-4 sm:py-6">
          <p className="hidden text-[14px] font-bold text-muted sm:block">Answers are scored at the end.</p>
          <button className="btn w-full sm:w-auto sm:min-w-[180px]" disabled={!answer} onClick={() => next()}>
            {last ? "Finish test" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

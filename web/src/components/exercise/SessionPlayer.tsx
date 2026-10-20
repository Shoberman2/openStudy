"use client";

import { BookOpen, CircleCheck, CircleX, Flame, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { checkAnswer, type Answer, type CheckResult, type Exercise } from "@/engine/exercises";
import { answerCurrent, current, isFinished, progress, startSession, type SessionState } from "@/engine/session";
import type { Grade } from "@/engine/types";
import { ProgressBar, Sheet } from "@/components/ui/basics";
import { ExerciseView, instructionFor } from "./ExerciseView";
import { SourceThumb } from "@/components/app/SourceImage";

export type Source = { book: string; header?: string; text?: string; image?: string; pageNumber?: number };

export type SessionSummary = {
  total: number;
  correctFirst: number;
  applyCorrect: number;
  mistakes: number;
  accuracy: number;
  seconds: number;
  maxCombo: number;
};

type Props = {
  exercises: Exercise[];
  mode?: "full" | "embedded";
  sourceFor?: (ex: Exercise) => Source | null;
  onGraded?: (grades: Record<string, Grade>) => void;
  onFinish: (s: SessionSummary) => void;
  onClose?: () => void;
};

export function SessionPlayer({ exercises, mode = "full", sourceFor, onGraded, onFinish, onClose }: Props) {
  const [state, setState] = useState<SessionState>(() => startSession(exercises));
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [pending, setPending] = useState<SessionState | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const ex = current(state);
  const full = mode === "full";

  const check = useCallback(
    (a?: Answer) => {
      const ans = a ?? answer;
      if (!ex || !ans || result) return;
      const r = checkAnswer(ex, ans);
      const { state: next, newlyGraded } = answerCurrent(state, r.verdict, r.grade);
      setResult(r);
      setPending(next);
      if (Object.keys(newlyGraded).length) onGraded?.(newlyGraded);
      if (typeof navigator !== "undefined" && "vibrate" in navigator && full) {
        try {
          navigator.vibrate(r.verdict === "wrong" ? [30, 40, 30] : 12);
        } catch {
          /* ignore */
        }
      }
    },
    [answer, ex, result, state, onGraded, full],
  );

  const next = useCallback(() => {
    if (!pending) return;
    setResult(null);
    setAnswer(null);
    setState(pending);
    setPending(null);
    if (isFinished(pending)) {
      onFinish({
        total: pending.total,
        correctFirst: pending.correctFirst,
        applyCorrect: pending.applyCorrect,
        mistakes: pending.mistakes,
        accuracy: pending.total ? (pending.correctFirst + pending.applyCorrect) / pending.total : 0,
        seconds: Math.round((Date.now() - pending.startedAt) / 1000),
        maxCombo: pending.maxCombo,
      });
    }
  }, [pending, onFinish]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "Enter" && !e.shiftKey) {
        if (result) {
          e.preventDefault();
          next();
        } else if (answer && tag !== "TEXTAREA") {
          e.preventDefault();
          check();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, result, answer, next, check]);

  // Opt-in hook for automated browser tests (localStorage "os-debug" = "1").
  useEffect(() => {
    try {
      if (localStorage.getItem("os-debug") === "1") (window as unknown as { __osEx?: Exercise }).__osEx = ex;
    } catch {
      /* ignore */
    }
  }, [ex]);

  const source = useMemo(() => (ex && sourceFor ? sourceFor(ex) : null), [ex, sourceFor]);
  const shown = pending ?? state;
  const autoChecked = ex?.type === "match" || ex?.type === "flash" || ex?.type === "explain" || ex?.type === "picture";

  if (!ex) return null;

  const body = (
    <div className={full ? "mx-auto w-full max-w-[640px] px-4 pt-6 pb-48 sm:pt-10" : "px-5 pt-4 pb-5 sm:px-6"}>
      <p className="kicker mb-3">{instructionFor(ex)}</p>
      <ExerciseView
        key={ex.id}
        ex={ex}
        result={result}
        onAnswer={setAnswer}
        onSubmit={(a) => check(a)}
        compact={!full}
        image={source?.image ? { key: source.image, pageNumber: source.pageNumber } : undefined}
      />
    </div>
  );

  const footer = result ? (
    <Feedback result={result} source={ex.type === "picture" ? null : source} onSource={() => setSourceOpen(true)} onContinue={next} full={full} />
  ) : (
    <div className={full ? "border-t-2 border-line bg-paper" : ""}>
      <div className={full ? "mx-auto flex w-full max-w-[640px] justify-end px-4 py-4 sm:py-6" : "px-5 pb-5 sm:px-6"}>
        {!autoChecked && (
          <button className={`btn btn-green ${full ? "w-full sm:w-auto sm:min-w-[180px]" : "btn-block"}`} disabled={!answer} onClick={() => check()}>
            Check
          </button>
        )}
      </div>
    </div>
  );

  const sheet = source && (
    <Sheet open={sourceOpen} onClose={() => setSourceOpen(false)} label="Source page">
      <p className="kicker">From</p>
      <p className="mb-4 pr-8 text-[20px] font-extrabold">{source.book}</p>
      {source.image && <SourceThumb imageKey={source.image} pageNumber={source.pageNumber} className="mb-4" />}
      <div className="rounded-[14px] border-2 border-line bg-[var(--page-paper)] p-5">
        {source.header && <p className="mb-3 text-center text-[13px] font-bold text-muted">{source.header}</p>}
        <p className="serif text-[18px] leading-relaxed whitespace-pre-line">{source.text}</p>
      </div>
    </Sheet>
  );

  if (!full) {
    return (
      <div>
        <div className="flex items-center gap-3 px-5 pt-5 sm:px-6">
          <div className="flex-1">
            <ProgressBar value={progress(shown)} color="green" label="Progress" />
          </div>
          <Combo n={shown.combo} />
        </div>
        {body}
        {footer}
        {sheet}
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 bg-paper">
        <div className="mx-auto flex w-full max-w-[640px] items-center gap-3 px-4 py-4">
          <button onClick={onClose} aria-label="Close session" className="-ml-1 rounded-full p-1.5 text-muted hover:bg-shelf">
            <X size={26} strokeWidth={2.75} />
          </button>
          <div className="flex-1">
            <ProgressBar value={progress(shown)} color="green" label="Lesson progress" />
          </div>
          <Combo n={shown.combo} />
        </div>
      </header>
      {body}
      <div className="fixed inset-x-0 bottom-0 z-30">{footer}</div>
      {sheet}
    </div>
  );
}

function Combo({ n }: { n: number }) {
  if (n < 3) return <div className="w-[52px]" aria-hidden />;
  return (
    <div key={n} className="anim-pop flex w-[52px] items-center justify-end gap-1 font-black text-[var(--yellow-lip)]" aria-label={`${n} in a row`}>
      <Flame size={22} strokeWidth={2.5} fill="var(--yellow)" className="text-yellow" />
      {n}
    </div>
  );
}

function Feedback({ result, source, onSource, onContinue, full }: { result: CheckResult; source: Source | null; onSource: () => void; onContinue: () => void; full: boolean }) {
  const ok = result.verdict !== "wrong";
  const tone = ok ? "green" : "red";
  return (
    <div
      className={`${full ? "anim-slide-up" : "anim-fade rounded-b-[18px]"} ${ok ? "bg-green-soft" : "bg-red-soft"}`}
      role="status"
      aria-live="polite"
    >
      <div className={full ? "mx-auto w-full max-w-[640px] px-4 py-5 sm:py-6" : "px-5 py-5 sm:px-6"}>
        <div className={`flex items-center gap-2.5 text-[22px] font-black ${ok ? "text-green" : "text-red"}`}>
          {ok ? <CircleCheck size={28} strokeWidth={2.75} /> : <CircleX size={28} strokeWidth={2.75} />}
          {ok ? (result.verdict === "close" ? "Correct, almost" : "Correct") : "Not quite"}
        </div>
        {result.note && <p className={`mt-1.5 font-bold ${ok ? "text-green" : "text-red"}`}>{result.note}</p>}
        {!ok && !result.diff && (
          <p className="mt-2 font-bold text-red">
            <span className="opacity-80">Correct answer: </span>
            {result.solution}
          </p>
        )}
        {result.diff && (
          <p className="serif mt-2 text-[18px] leading-relaxed">
            {result.diff.map((d, i) => (
              <span key={i} className={d.status === "missing" ? "font-semibold text-red underline decoration-2 underline-offset-4" : d.status === "extra" ? "text-muted line-through" : ""}>
                {d.word}{" "}
              </span>
            ))}
          </p>
        )}
        {source?.image && <SourceThumb imageKey={source.image} pageNumber={source.pageNumber} className="mt-3" />}
        <div className={`mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center ${source ? "sm:justify-between" : "sm:justify-end"}`}>
          {source && (
            <button onClick={onSource} className={`flex items-center gap-2 text-left text-[15px] font-bold ${ok ? "text-green" : "text-red"} hover:underline`}>
              <BookOpen size={18} strokeWidth={2.5} className="flex-none" />
              <span className="line-clamp-1">From {source.book}</span>
            </button>
          )}
          <button autoFocus={full} className={`btn btn-${tone} ${full ? "w-full sm:w-auto sm:min-w-[180px]" : "btn-block sm:w-auto sm:min-w-[160px]"}`} onClick={onContinue}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { adaptiveFollowups, attemptsFor, nextLevel, type Attempt } from "@/engine/tutor/adaptive";
import type { FollowupsBlock, QuizBlock as Quiz } from "@/engine/tutor/blocks";
import { Line } from "./Prose";

/** One question at a time; after answering, every option explains itself. */
export function QuizBlock({ block, attempts, onAttempt, onAsk }: { block: Quiz; attempts: Attempt[]; onAttempt: (a: Attempt) => void; onAsk: (prompt: string) => void }) {
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [right, setRight] = useState(0);
  const [missed, setMissed] = useState<string | undefined>();
  const q = block.questions[at];
  const done = at >= block.questions.length;

  const check = () => {
    const o = q.options.find((x) => x.id === picked);
    if (!o) return;
    setLocked(true);
    if (o.correct) setRight((r) => r + 1);
    else setMissed(q.stem);
    onAttempt({ concept: q.concept, difficulty: q.difficulty, correct: o.correct, at: new Date().toISOString() });
  };
  const advance = () => {
    setAt((i) => i + 1);
    setPicked(null);
    setLocked(false);
  };

  const list = attemptsFor({ attempts }, block.concept);
  const level = nextLevel(list);
  const after: FollowupsBlock = adaptiveFollowups(block.concept, list, missed);

  return (
    <section data-testid="quiz">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[18px] font-semibold text-ink">{block.title}</h3>
        {!done && <span className="mono flex-none text-[15px] text-muted">{at + 1} of {block.questions.length} · level {q.difficulty}</span>}
      </div>
      {block.levelReason && at === 0 && !locked && <p className="mt-0.5 text-[15px] text-muted">{block.levelReason}</p>}

      {!done ? (
        <div className="mt-3">
          <p className="text-[18px] font-medium leading-snug text-ink">
            <Line text={q.stem} />
          </p>
          <div className="mt-3 grid gap-2" role="group" aria-label="Answers">
            {q.options.map((o) => {
              const isPicked = picked === o.id;
              const state = !locked ? "" : o.correct ? "is-right" : isPicked ? "is-wrong" : "";
              return (
                <div key={o.id}>
                  <button className={`choice ${state}`} aria-pressed={isPicked} disabled={locked} onClick={() => setPicked(o.id)}>
                    <span className="min-w-0 flex-1">
                      <Line text={o.text} />
                    </span>
                    {locked && o.correct && <Check size={20} className="flex-none text-green" aria-label="Correct" />}
                    {locked && isPicked && !o.correct && <X size={20} className="flex-none text-red" aria-label="Your answer" />}
                  </button>
                  {locked && (
                    <p className="anim-fade mt-1 px-3 text-[16px] leading-snug text-muted" data-testid="option-explanation">
                      <Line text={o.explanation} />
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3">
            {!locked ? (
              <button className="pill" disabled={!picked} onClick={check}>Check answer</button>
            ) : (
              <button className="pill" onClick={advance}>{at + 1 < block.questions.length ? "Next question" : "See result"}</button>
            )}
          </div>
        </div>
      ) : (
        <div className="anim-fade mt-3" data-testid="quiz-result">
          <p className="text-[20px] font-semibold text-ink">{right} of {block.questions.length} right</p>
          <p className="mt-0.5 text-[16px] text-muted">{level.reason}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {after.items.map((f, i) => (
              <button key={f.label} className={`pill ${i ? "pill-ghost" : ""}`} onClick={() => onAsk(f.prompt)}>{f.label}</button>
            ))}
          </div>
        </div>
      )}
      {block.quality && (
        <p className="mt-3 text-[14px] text-muted">
          Passed {block.quality.checks} automatic checks and a rubric review, {block.quality.score} of 5{block.quality.mode === "demo" ? " (demo critic)" : ""}.
        </p>
      )}
    </section>
  );
}

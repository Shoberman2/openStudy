"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import type { StepsBlock as Steps } from "@/engine/tutor/blocks";
import { compile } from "@/engine/tutor/expr";
import { Line, Prose } from "./Prose";

/** Compares numbers and simple expressions: 1/2 matches 0.5. Null when the attempt is not a number. */
function matches(attempt: string, check: string): boolean | null {
  try {
    const read = (s: string) => compile(s.replace(/,/g, "").replace(/^[a-z]\s*=\s*/i, "")).eval({});
    const [a, b] = [read(attempt), read(check)];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));
  } catch {
    return null;
  }
}

/** Reveals one step at a time and asks the learner to try it first. */
export function StepsBlock({ block }: { block: Steps }) {
  const [shown, setShown] = useState(0);
  const [attempt, setAttempt] = useState("");
  const [result, setResult] = useState<boolean | null | undefined>(undefined);
  const next = block.steps[shown];
  const done = shown >= block.steps.length;

  const reveal = () => {
    setShown((s) => s + 1);
    setAttempt("");
    setResult(undefined);
  };

  return (
    <section data-testid="steps">
      <h3 className="text-[18px] font-semibold text-ink">{block.title}</h3>
      <div className="mt-1">
        <Prose text={block.problem} />
      </div>
      <ol className="mt-3 grid gap-3">
        {block.steps.slice(0, shown).map((s, i) => (
          <li key={i} className="anim-fade rounded-[14px] bg-shelf p-3">
            <Prose text={s.work} />
            <p className="mt-1 text-[16px] text-muted">
              <Line text={s.why} />
            </p>
          </li>
        ))}
      </ol>
      {!done ? (
        <div className="mt-3">
          <p className="text-[17px] font-medium text-ink">
            <Line text={next.ask} />
          </p>
          {next.check ? (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (attempt.trim()) setResult(matches(attempt, next.check!));
              }}
            >
              <input className="input !py-2 min-w-0 flex-1" value={attempt} onChange={(e) => { setAttempt(e.target.value); setResult(undefined); }} placeholder="Your answer" aria-label="Your answer" inputMode="text" />
              <button className="pill pill-ghost flex-none" disabled={!attempt.trim()}>
                Check
              </button>
            </form>
          ) : null}
          {result === true && <p className="mt-2 flex items-center gap-1.5 text-[16px] font-medium text-green"><Check size={18} /> That is right.</p>}
          {result === false && <p className="mt-2 text-[16px] font-medium text-red">Not quite. Try again, or see the step.</p>}
          {result === null && <p className="mt-2 text-[16px] text-muted">Enter a number or a simple sum.</p>}
          <div className="mt-2">
            <button className="pill" onClick={reveal}>
              {result === true ? "Next step" : "Show step"}
            </button>
          </div>
        </div>
      ) : (
        <div className="anim-fade mt-3">
          <p className="text-[15px] text-muted">Answer</p>
          <div className="font-semibold text-ink">
            <Prose text={block.answer} />
          </div>
        </div>
      )}
    </section>
  );
}

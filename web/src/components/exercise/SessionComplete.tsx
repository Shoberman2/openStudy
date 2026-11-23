"use client";

// End of a session (spec 17.2): how it went in two facts, an optional follow-up, one Continue.
import type { ReactNode } from "react";

export function SessionComplete({
  title,
  accuracy,
  seconds,
  level,
  children,
  onContinue,
}: {
  title: string;
  accuracy: number;
  seconds: number;
  level?: number;
  /** One follow-up question shown under the result, such as the exam date after a first drill. */
  children?: ReactNode;
  onContinue: () => void;
}) {
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="anim-fade mx-auto flex w-full max-w-[640px] flex-1 flex-col items-center px-4 pb-40 pt-16 text-center sm:pt-24">
        <h1 className="text-[32px] font-black leading-tight tracking-tight">{title}</h1>
        {level !== undefined && <p className="mt-1 text-[17px] text-muted">Level {level} of 5</p>}
        <dl className="mt-10 flex justify-center gap-14">
          <div>
            <dt className="text-[16px] font-bold text-muted">Accuracy</dt>
            <dd className="num mt-1 text-[30px] font-black">{Math.round(accuracy * 100)}%</dd>
          </div>
          <div>
            <dt className="text-[16px] font-bold text-muted">Time</dt>
            <dd className="num mt-1 text-[30px] font-black">
              {mm}:{ss}
            </dd>
          </div>
        </dl>
        {children && <div className="mt-12 w-full max-w-[420px] text-left">{children}</div>}
      </main>
      <div className="fixed inset-x-0 bottom-0 bg-paper">
        <div className="mx-auto flex w-full max-w-[640px] justify-end px-4 py-4 sm:py-6">
          <button autoFocus className="btn w-full sm:w-auto sm:min-w-[180px]" onClick={onContinue}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

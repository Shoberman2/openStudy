"use client";

// Onboarding (spec 17.2): three screens to the first drill. Goals and practice style no longer
// change the session mix (13.8), so they are not asked; the exam date is asked after the first drill.
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { logEvent } from "@/engine/library";
import type { Bringing, DailyGoal, Library, Profile } from "@/engine/types";
import { useLibrary } from "@/lib/store";
import { ProgressBar } from "@/components/ui/basics";
import { OptionTile } from "@/components/ui/OptionTile";
import { Loading } from "@/components/app/AppChrome";

type Opt<T> = { value: T; label: string; sub?: string };

const BRINGING: Opt<Bringing>[] = [
  { value: "class", label: "Classes", sub: "Class notes, slides, PDFs, whiteboard photos" },
  { value: "books", label: "Books I'm reading", sub: "Apple Books screenshots, Notes excerpts" },
  { value: "anything", label: "Anything else", sub: "Docs, articles, training, a new hobby" },
];
const MINUTES: Opt<DailyGoal>[] = [
  { value: 10, label: "5 minutes a day" },
  { value: 20, label: "10 minutes a day" },
  { value: 30, label: "15 minutes a day" },
  { value: 50, label: "20 minutes a day" },
];

// What the removed questions used to set. Every exercise type stays available; "apply" stays off.
const DEFAULT_GOALS: Profile["goals"] = ["ideas", "facts"];
const DEFAULT_PRACTICE: Profile["practice"] = ["tap", "blank", "type"];

type Step = "bringing" | "daily" | "first";
const TITLES: Record<Step, string> = {
  bringing: "What are you studying?",
  daily: "How long each day?",
  first: "Add your notes",
};
const SUBS: Record<Step, string> = {
  bringing: "Pick as many as you like. Everything stays on this device.",
  daily: "Your plan fits into this. Change it any time.",
  first: "You will be answering questions from them in a minute.",
};

export default function Welcome() {
  const { ready, update } = useLibrary();
  const router = useRouter();
  const [stepIdx, setStepIdx] = useState(0);
  const [bringing, setBringing] = useState<Bringing[]>([]);
  const [daily, setDaily] = useState<DailyGoal | null>(null);

  if (!ready) return <Loading />;

  const steps: Step[] = ["bringing", "daily", "first"];
  const step = steps[stepIdx];
  const canContinue = step === "bringing" ? bringing.length > 0 : step === "daily" ? daily !== null : false;

  const finish = (dest: "files" | "notes") => {
    update((l) => {
      let next: Library = { ...l, profile: { ...l.profile, bringing, goals: DEFAULT_GOALS, practice: DEFAULT_PRACTICE, dailyGoalXP: daily ?? 20, onboarded: true } };
      next = logEvent(next, "onboarding_done", { goal: DEFAULT_GOALS.join(","), practice: DEFAULT_PRACTICE.join(","), bringing: bringing.join(","), dailyGoalXP: daily ?? 20, exam: false });
      return next;
    });
    router.replace(`/app/import?mode=${dest}`);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[640px] items-center gap-3 px-4 py-4">
        <button
          aria-label="Back"
          disabled={stepIdx === 0}
          onClick={() => setStepIdx((s) => Math.max(0, s - 1))}
          className="-ml-1.5 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-shelf disabled:opacity-0"
        >
          <ArrowLeft size={24} strokeWidth={2.5} />
        </button>
        <div className="flex-1">
          <ProgressBar value={(stepIdx + 1) / steps.length} label="Setup progress" />
        </div>
      </header>
      <main key={step} className="anim-fade mx-auto w-full max-w-[640px] flex-1 px-4 pb-40 pt-6 sm:pt-12">
        <h1 className="text-[30px] font-black leading-tight tracking-tight sm:text-[36px]">{TITLES[step]}</h1>
        <p className="mt-1.5 text-[17px] text-muted">{SUBS[step]}</p>
        <div className="mt-6 grid grid-cols-1 gap-3">
          {step === "bringing" &&
            BRINGING.map((o) => (
              <OptionTile
                key={o.value}
                {...o}
                selected={bringing.includes(o.value)}
                onClick={() => setBringing((b) => (b.includes(o.value) ? b.filter((x) => x !== o.value) : [...b, o.value]))}
              />
            ))}
          {step === "daily" && MINUTES.map((o) => <OptionTile key={o.value} {...o} selected={daily === o.value} onClick={() => setDaily(o.value)} />)}
          {step === "first" && (
            <>
              <OptionTile label="Upload files" sub="Notes, slides, PDFs, docs or photos" selected={false} onClick={() => finish("files")} />
              <OptionTile label="Paste notes" sub="Copy from your notes app or a doc" selected={false} onClick={() => finish("notes")} />
            </>
          )}
        </div>
      </main>
      {step !== "first" && (
        <div className="fixed inset-x-0 bottom-0 bg-paper">
          <div className="mx-auto flex w-full max-w-[640px] justify-end px-4 py-4 sm:py-6">
            <button className="btn w-full sm:w-auto sm:min-w-[180px]" disabled={!canContinue} onClick={() => setStepIdx((s) => s + 1)}>
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

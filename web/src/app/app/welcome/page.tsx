"use client";

import { ArrowLeft, BookCopy, BookOpen, Brain, CalendarDays, Dumbbell, GraduationCap, Hand, Keyboard, Layers, Lightbulb, NotebookPen, Quote, Shapes, SquareDashedText, Target, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { logEvent } from "@/engine/library";
import type { Bringing, DailyGoal, Goal, Library, PracticePref, Profile } from "@/engine/types";
import { addDays, localDay } from "@/engine/util";
import { withSample } from "@/lib/actions";
import { useLibrary } from "@/lib/store";
import { ProgressBar } from "@/components/ui/basics";
import { OptionTile } from "@/components/ui/OptionTile";
import { Loading } from "@/components/app/AppChrome";

type Opt<T> = { value: T; label: string; sub?: string; icon: ReactNode };
const I = { size: 24, strokeWidth: 2.5 };

const BRINGING: Opt<Bringing>[] = [
  { value: "books", label: "Books I'm reading", sub: "Apple Books screenshots, Notes excerpts", icon: <BookOpen {...I} /> },
  { value: "class", label: "Classes", sub: "Slides, PDFs, class notes, whiteboard photos", icon: <GraduationCap {...I} /> },
  { value: "anything", label: "Anything else", sub: "Docs, articles, training, a new hobby", icon: <Shapes {...I} /> },
];
const GOALS: Opt<Goal>[] = [
  { value: "ideas", label: "Remember the big ideas", icon: <Lightbulb {...I} /> },
  { value: "facts", label: "Know the facts cold", icon: <Brain {...I} /> },
  { value: "quotes", label: "Quote it word for word", icon: <Quote {...I} /> },
  { value: "apply", label: "Use it in real life", icon: <Dumbbell {...I} /> },
];
const PRACTICE: Opt<PracticePref>[] = [
  { value: "tap", label: "Quick taps", sub: "Multiple choice, true or false, matching", icon: <Hand {...I} /> },
  { value: "blank", label: "Fill in the blank", sub: "Tap the missing word", icon: <SquareDashedText {...I} /> },
  { value: "type", label: "Type it from memory", sub: "The hardest, the stickiest", icon: <Keyboard {...I} /> },
  { value: "flash", label: "Flashcards", sub: "Flip and grade yourself", icon: <Layers {...I} /> },
];
const GOAL_XP: Opt<DailyGoal>[] = [
  { value: 10, label: "Casual", sub: "5 min a day, 10 XP", icon: <Target {...I} /> },
  { value: 20, label: "Regular", sub: "10 min a day, 20 XP", icon: <Target {...I} /> },
  { value: 30, label: "Serious", sub: "15 min a day, 30 XP", icon: <Target {...I} /> },
  { value: 50, label: "Intense", sub: "20 min a day, 50 XP", icon: <Target {...I} /> },
];

type Step = "bringing" | "exam" | "goals" | "practice" | "daily" | "first";
const TITLES: Record<Step, string> = {
  bringing: "What are you studying?",
  exam: "Got an exam coming up?",
  goals: "What do you want from it?",
  practice: "How do you like to practice?",
  daily: "Pick a daily goal",
  first: "Add your first material",
};
const SUBS: Partial<Record<Step, string>> = {
  bringing: "Pick as many as you like. Everything stays on this device.",
  exam: "We will plan your study days around it. You can change it later.",
  goals: "Pick as many as you like.",
  practice: "Pick as many as you like.",
  daily: "You can change it any time.",
};

export default function Welcome() {
  const { ready, update } = useLibrary();
  const router = useRouter();
  const [stepIdx, setStepIdx] = useState(0);
  const [p, setP] = useState<Pick<Profile, "bringing" | "goals" | "practice" | "dailyGoalXP">>({ bringing: [], goals: [], practice: [], dailyGoalXP: 20 });
  const [exam, setExam] = useState<string | null | undefined>(undefined); // undefined: not answered, null: "Not yet"
  const [goalPicked, setGoalPicked] = useState(false);
  const minDate = localDay(addDays(new Date(), 1));

  if (!ready) return <Loading />;

  const steps: Step[] = ["bringing", ...(p.bringing.includes("class") ? (["exam"] as Step[]) : []), "goals", "practice", "daily", "first"];
  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const canContinue: Record<Step, boolean> = {
    bringing: p.bringing.length > 0,
    exam: exam !== undefined && (exam === null || !!exam),
    goals: p.goals.length > 0,
    practice: p.practice.length > 0,
    daily: goalPicked,
    first: false,
  };

  const finish = (dest: "files" | "notes" | "sample") => {
    update((l) => {
      let next: Library = { ...l, profile: { ...l.profile, ...p, onboarded: true, pendingGoalDate: exam || undefined } };
      next = logEvent(next, "onboarding_done", { goal: p.goals.join(","), practice: p.practice.join(","), bringing: p.bringing.join(","), dailyGoalXP: p.dailyGoalXP, exam: !!exam });
      if (dest === "sample") next = withSample(next);
      return next;
    });
    router.replace(dest === "sample" ? "/app" : `/app/import?mode=${dest}`);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[640px] items-center gap-3 px-4 py-4">
        <button
          aria-label="Back"
          disabled={stepIdx === 0}
          onClick={() => setStepIdx((s) => Math.max(0, s - 1))}
          className="-ml-1.5 rounded-full p-1.5 text-muted hover:bg-shelf disabled:opacity-0"
        >
          <ArrowLeft size={24} strokeWidth={2.75} />
        </button>
        <div className="flex-1">
          <ProgressBar value={(stepIdx + 1) / steps.length} label="Setup progress" />
        </div>
      </header>
      <main key={step} className="anim-fade mx-auto w-full max-w-[640px] flex-1 px-4 pb-40 pt-6 sm:pt-12">
        <h1 className="text-[28px] font-black leading-tight tracking-tight sm:text-[34px]">{TITLES[step]}</h1>
        {SUBS[step] && <p className="mt-1.5 text-muted">{SUBS[step]}</p>}
        <div className="mt-6 grid grid-cols-1 gap-3">
          {step === "bringing" &&
            BRINGING.map((o) => <OptionTile key={o.value} {...o} selected={p.bringing.includes(o.value)} onClick={() => setP({ ...p, bringing: toggle(p.bringing, o.value) })} />)}
          {step === "exam" && (
            <>
              <label className={`tile cursor-pointer ${exam ? "is-selected" : ""}`}>
                <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-[12px] ${exam ? "bg-blue text-white" : "bg-shelf text-ink"}`}>
                  <CalendarDays {...I} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">Yes, on</span>
                  <input
                    type="date"
                    min={minDate}
                    value={exam ?? ""}
                    aria-label="Exam date"
                    onChange={(e) => setExam(e.target.value || undefined)}
                    className="mt-1 w-full max-w-[220px] rounded-[10px] border-2 border-line bg-paper px-2.5 py-1.5 text-[16px] font-bold text-ink"
                  />
                </span>
              </label>
              <OptionTile icon={<CalendarDays {...I} />} label="Not yet" sub="Add a date from the class later" selected={exam === null} onClick={() => setExam(null)} />
            </>
          )}
          {step === "goals" && GOALS.map((o) => <OptionTile key={o.value} {...o} selected={p.goals.includes(o.value)} onClick={() => setP({ ...p, goals: toggle(p.goals, o.value) })} />)}
          {step === "practice" && PRACTICE.map((o) => <OptionTile key={o.value} {...o} selected={p.practice.includes(o.value)} onClick={() => setP({ ...p, practice: toggle(p.practice, o.value) })} />)}
          {step === "daily" &&
            GOAL_XP.map((o) => (
              <OptionTile
                key={o.value}
                {...o}
                selected={goalPicked && p.dailyGoalXP === o.value}
                onClick={() => {
                  setP({ ...p, dailyGoalXP: o.value });
                  setGoalPicked(true);
                }}
              />
            ))}
          {step === "first" && (
            <>
              <OptionTile icon={<Upload {...I} />} label="Import files" sub="Screenshots, photos of notes, PDFs, slides, docs" selected={false} onClick={() => finish("files")} />
              <OptionTile icon={<NotebookPen {...I} />} label="Paste notes" sub="Class notes or Apple Books excerpts" selected={false} onClick={() => finish("notes")} />
              <OptionTile icon={<BookCopy {...I} />} label="Try the samples" sub="Two books and a biology class with an exam" selected={false} onClick={() => finish("sample")} />
            </>
          )}
        </div>
      </main>
      {step !== "first" && (
        <div className="fixed inset-x-0 bottom-0 border-t-2 border-line bg-paper">
          <div className="mx-auto flex w-full max-w-[640px] justify-end px-4 py-4 sm:py-6">
            <button className="btn w-full sm:w-auto sm:min-w-[180px]" disabled={!canContinue[step]} onClick={() => setStepIdx((s) => s + 1)}>
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { Download, RotateCcw, Sparkles, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { emptyLibrary, exportLibrary, mergeLibrary, normalizeLibrary, weekStats } from "@/engine/library";
import type { Bringing, DailyGoal, Goal, PracticePref } from "@/engine/types";
import { localDay } from "@/engine/util";
import { smartOrganizeOn } from "@/lib/ai";
import { useLibrary } from "@/lib/store";
import { BackHeader, Loading, Page } from "@/components/app/AppChrome";

const STUDYING: [Bringing, string][] = [
  ["books", "Books I'm reading"],
  ["class", "Classes"],
  ["anything", "Anything else"],
];
const GOALS: [Goal, string][] = [
  ["ideas", "Remember the big ideas"],
  ["facts", "Know the facts cold"],
  ["quotes", "Quote it word for word"],
  ["apply", "Use it in real life"],
];
const PRACTICE: [PracticePref, string][] = [
  ["tap", "Quick taps"],
  ["blank", "Fill in the blank"],
  ["type", "Type it from memory"],
  ["flash", "Flashcards"],
];
const DAILY: [DailyGoal, string][] = [
  [10, "Casual, 10 XP"],
  [20, "Regular, 20 XP"],
  [30, "Serious, 30 XP"],
  [50, "Intense, 50 XP"],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-9 first:mt-2">
      <h2 className="mb-3 text-[20px] font-black">{title}</h2>
      {children}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className="tile !min-h-[48px] !w-auto !py-2.5" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

export default function SettingsPage() {
  const { lib, ready, update, replace } = useLibrary();
  const router = useRouter();
  const [smart, setSmart] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    void smartOrganizeOn().then(setSmart);
  }, []);
  if (!ready) return <Loading />;

  const p = lib.profile;
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? (arr.length > 1 ? arr.filter((x) => x !== v) : arr) : [...arr, v]);
  const week = weekStats(lib);

  const doExport = () => {
    const blob = new Blob([JSON.stringify(exportLibrary(lib), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `openstudy-library-${localDay()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (raw?.version !== 1) throw new Error("version");
      const incoming = normalizeLibrary(raw);
      update((l) => mergeLibrary(l, incoming));
      setMsg(`Merged ${incoming.projects.length} book${incoming.projects.length === 1 ? "" : "s"} and ${incoming.cards.length} cards.`);
    } catch {
      setMsg("That file is not an OpenStudy library.");
    }
  };

  return (
    <>
      <BackHeader href="/app" title="Settings" />
      <Page>
        <Section title="Your week">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Days active", `${week.daysActive} of 7`],
              ["Sessions", String(week.sessions)],
              ["Accuracy", week.accuracy === null ? "None yet" : `${Math.round(week.accuracy * 100)}%`],
              ["Cards due", String(week.due)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[16px] border-2 border-line p-4" style={{ boxShadow: "0 3px 0 var(--line)" }}>
                <p className="text-[13px] font-extrabold text-muted">{k}</p>
                <p className="mt-1 text-[22px] font-black">{v}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="What you're studying">
          <div className="flex flex-wrap gap-2.5">
            {STUDYING.map(([v, label]) => (
              <Chip key={v} on={p.bringing.includes(v)} onClick={() => update((l) => ({ ...l, profile: { ...l.profile, bringing: toggle(l.profile.bringing, v) } }))}>
                {label}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="What you want from it">
          <div className="flex flex-wrap gap-2.5">
            {GOALS.map(([v, label]) => (
              <Chip key={v} on={p.goals.includes(v)} onClick={() => update((l) => ({ ...l, profile: { ...l.profile, goals: toggle(l.profile.goals, v) } }))}>
                {label}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="How you like to practice">
          <div className="flex flex-wrap gap-2.5">
            {PRACTICE.map(([v, label]) => (
              <Chip key={v} on={p.practice.includes(v)} onClick={() => update((l) => ({ ...l, profile: { ...l.profile, practice: toggle(l.profile.practice, v) } }))}>
                {label}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="Daily goal">
          <div className="flex flex-wrap gap-2.5">
            {DAILY.map(([v, label]) => (
              <Chip key={v} on={p.dailyGoalXP === v} onClick={() => update((l) => ({ ...l, profile: { ...l.profile, dailyGoalXP: v } }))}>
                {label}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="Smart organize">
          <div className="card flex items-start gap-3 p-4">
            <Sparkles size={22} strokeWidth={2.5} className={smart ? "text-blue" : "text-muted"} />
            <div>
              <p className="font-extrabold">Smart organize: {smart === null ? "checking" : smart ? "on" : "off"}</p>
              <p className="text-[15px] text-muted">
                {smart
                  ? "Sorting and lesson building use Claude on the server."
                  : "Everything runs offline on this device. Set ANTHROPIC_API_KEY on the server to turn it on."}
              </p>
            </div>
          </div>
        </Section>

        <Section title="Library">
          <div className="grid gap-3 sm:grid-cols-2">
            <button className="btn btn-secondary btn-block" onClick={doExport}>
              <Download size={20} strokeWidth={2.5} /> Export library
            </button>
            <label className="btn btn-secondary btn-block">
              <Upload size={20} strokeWidth={2.5} /> Import library
              <input type="file" accept="application/json,.json" className="sr-only" data-testid="library-input" onChange={(e) => void doImport(e.target.files?.[0])} />
            </label>
          </div>
          {msg && <p className="anim-fade mt-3 font-bold text-green">{msg}</p>}
          <p className="mt-3 text-[14px] text-muted">The export is a JSON file you can open in the iPhone app. Screenshot images stay on this device.</p>
          <button
            className="btn btn-red mt-6"
            onClick={() => {
              if (!confirm("Delete every book, page and lesson on this device?")) return;
              replace(emptyLibrary());
              router.replace("/app/welcome");
            }}
          >
            <RotateCcw size={20} strokeWidth={2.5} /> Reset everything
          </button>
        </Section>
      </Page>
    </>
  );
}

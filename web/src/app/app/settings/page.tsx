"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { emptyLibrary, exportLibrary, mergeLibrary, normalizeLibrary, weekStats } from "@/engine/library";
import type { Bringing, DailyGoal, Goal, PracticePref } from "@/engine/types";
import { localDay } from "@/engine/util";
import { smartOrganizeOn } from "@/lib/ai";
import { setSharingUsage, sharingUsage } from "@/lib/events";
import { useLibrary } from "@/lib/store";
import { useThemeSetting } from "@/lib/theme";
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
  [10, "5 min"],
  [20, "10 min"],
  [30, "15 min"],
  [50, "20 min"],
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

const noSubscribe = () => () => {};

export default function SettingsPage() {
  const { lib, ready, update, replace } = useLibrary();
  const router = useRouter();
  const [smart, setSmart] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");
  const [theme, setTheme] = useThemeSetting();
  // Read after hydration: the server can't see this device's choice.
  const stored = useSyncExternalStore(noSubscribe, sharingUsage, () => null);
  const [chosen, setShare] = useState<boolean | null>(null);
  const share = chosen ?? stored;
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
      setMsg(`Merged ${incoming.projects.length} study set${incoming.projects.length === 1 ? "" : "s"} and ${incoming.cards.length} cards.`);
    } catch {
      setMsg("That file is not an OpenStudy library.");
    }
  };

  return (
    <>
      <BackHeader href="/app" title="Settings" />
      <Page>
        <Section title="Appearance">
          <div className="grid max-w-[320px] grid-cols-2 gap-1 rounded-full bg-shelf p-1" role="radiogroup" aria-label="Appearance">
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={theme === t}
                onClick={() => setTheme(t)}
                className={`h-10 rounded-full text-[16px] font-extrabold ${theme === t ? "bg-paper text-ink shadow-sm" : "text-muted"}`}
              >
                {t === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Your week">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              ["Days active", `${week.daysActive} of 7`],
              ["Sessions", String(week.sessions)],
              ["Accuracy", week.accuracy === null ? "None yet" : `${Math.round(week.accuracy * 100)}%`],
              ["Cards due", String(week.due)],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-[15px] font-bold text-muted">{k}</p>
                <p className="num mt-1 text-[24px] font-black">{v}</p>
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

        <Section title="Time each day">
          <div className="flex flex-wrap gap-2.5">
            {DAILY.map(([v, label]) => (
              <Chip key={v} on={p.dailyGoalXP === v} onClick={() => update((l) => ({ ...l, profile: { ...l.profile, dailyGoalXP: v } }))}>
                {label}
              </Chip>
            ))}
          </div>
        </Section>

        {smart && (
          <Section title="Smart organize">
            <p className="text-[16px] text-muted">On. Sorting, lesson building and Ask use Claude on the server.</p>
          </Section>
        )}

        <Section title="Usage data">
          <div className="flex items-start justify-between gap-4 rounded-[16px] bg-shelf p-4">
            <div>
              <p className="font-extrabold">Share usage data</p>
              <p className="text-[15px] text-muted">Counts and categories only, never your notes. It shows us what to build next.</p>
            </div>
            <button
              role="switch"
              aria-checked={!!share}
              aria-label="Share usage data"
              className={`relative mt-1 h-8 w-14 shrink-0 rounded-full transition-colors ${share ? "bg-blue" : "bg-line"}`}
              onClick={() => {
                setSharingUsage(!share);
                setShare(!share);
              }}
            >
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-paper shadow transition-all ${share ? "left-7" : "left-1"}`} />
            </button>
          </div>
        </Section>

        <Section title="Library">
          <div className="grid gap-3 sm:grid-cols-2">
            <button className="btn btn-secondary btn-block" onClick={doExport}>
              Export library
            </button>
            <label className="btn btn-secondary btn-block">
              Import library
              <input type="file" accept="application/json,.json" className="sr-only" data-testid="library-input" onChange={(e) => void doImport(e.target.files?.[0])} />
            </label>
          </div>
          {msg && <p className="anim-fade mt-3 font-bold text-green">{msg}</p>}
          <p className="mt-3 text-[15px] text-muted">The export is a JSON file you can open in the iPhone app. Screenshot images stay on this device.</p>
          <button
            className="btn btn-red mt-6"
            onClick={() => {
              if (!confirm("Delete every study set, page and lesson on this device?")) return;
              replace(emptyLibrary());
              router.replace("/app/welcome");
            }}
          >
            Reset everything
          </button>
        </Section>
      </Page>
    </>
  );
}

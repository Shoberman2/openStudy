"use client";

// Remember a Fact (spec 19): save what you just looked up, quizzed from tomorrow.
// Also opens with ?q=&a=&s= so an iPhone Shortcut or a bookmark can fill it in.
import { useEffect, useRef, useState } from "react";
import { lookedUpFacts, rememberFact } from "@/engine/lookup";
import { useLibrary } from "@/lib/store";
import { BackHeader, Loading, Page } from "@/components/app/AppChrome";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function RememberPage() {
  const { lib, ready, update } = useLibrary();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [source, setSource] = useState("");
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState("");
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    // Prefill once from a Shortcut or bookmark link.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (p.get("q")) setQuestion(p.get("q")!);
    if (p.get("a")) setAnswer(p.get("a")!);
    if (p.get("s")) setSource(p.get("s")!);
  }, []);

  if (!ready) return <Loading />;
  const facts = lookedUpFacts(lib);
  const q = search.trim().toLowerCase();
  const shown = q ? facts.filter((c) => `${c.question} ${c.answer}`.toLowerCase().includes(q)) : facts;
  const canSave = question.trim() && answer.trim();

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    update((l) => rememberFact(l, { question, answer, source }));
    setQuestion("");
    setAnswer("");
    setSource("");
    setSaved(true);
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    first.current?.focus();
  };

  return (
    <>
      <BackHeader href="/app" />
      <Page>
        <h1 className="text-[32px] font-black leading-tight tracking-tight">Remember a Fact</h1>
        <p className="mt-1 text-[16px] text-muted">Save what you looked up. You get quizzed on it from tomorrow.</p>
        <form className="mt-6 grid grid-cols-1 gap-3" onSubmit={save}>
          <label className="grid gap-1.5">
            <span className="text-[16px] font-bold">What did you look up?</span>
            <input ref={first} className="input" value={question} placeholder="How far away is the Moon?" onChange={(e) => (setQuestion(e.target.value), setSaved(false))} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[16px] font-bold">The answer</span>
            <input className="input" value={answer} placeholder="About 238,900 miles" onChange={(e) => (setAnswer(e.target.value), setSaved(false))} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[16px] font-bold">Where you found it (optional)</span>
            <input className="input" value={source} placeholder="Link or source" onChange={(e) => setSource(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-block mt-2" disabled={!canSave}>
            Remember
          </button>
          <p className="min-h-[24px] text-center text-[16px] font-bold text-green" aria-live="polite">
            {saved ? "Saved. First quiz tomorrow." : ""}
          </p>
        </form>

        {facts.length > 0 && (
          <section className="mt-10" aria-label="Looked Up">
            <h2 className="text-[22px] font-black">
              Looked Up <span className="text-muted">{facts.length}</span>
            </h2>
            {facts.length >= 8 && <input className="input mt-3" type="search" value={search} placeholder="Search what you looked up" aria-label="Search what you looked up" onChange={(e) => setSearch(e.target.value)} />}
            <ul className="mt-3 grid grid-cols-1 gap-4">
              {shown.map((c) => (
                <li key={c.id} className="px-1">
                  <span className="block text-[17px] font-extrabold">{c.question}</span>
                  <span className="block text-[16px] text-muted">
                    {c.answer}
                    {c.attribution && /^https?:\/\//.test(c.attribution) ? (
                      <>
                        {" · "}
                        <a href={c.attribution} target="_blank" rel="noreferrer" className="text-blue hover:underline">
                          Source
                        </a>
                      </>
                    ) : c.attribution ? (
                      ` · ${c.attribution}`
                    ) : null}
                  </span>
                  <span className="block text-[15px] text-muted">Next quiz {shortDate(c.srs.due)}</span>
                </li>
              ))}
              {q && !shown.length && <li className="px-1 text-muted">Nothing you looked up matches &quot;{search.trim()}&quot;.</li>}
            </ul>
          </section>
        )}
      </Page>
    </>
  );
}

"use client";

import { LoaderCircle, MessageCircleQuestion } from "lucide-react";
import { useState } from "react";
import { logEvent } from "@/engine/library";
import type { Library, Page } from "@/engine/types";
import { askNotes, type AskResult } from "@/lib/ai";

/** "Ask about <Title>" / "Ask my notes" (spec 10.7). Answers come from the notes, with their source. */
export function AskBox({
  lib,
  pages,
  scope,
  label,
  update,
}: {
  lib: Library;
  pages: Page[];
  scope: "project" | "all";
  label: string;
  update: (fn: (l: Library) => Library) => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ question: string; r: AskResult } | null>(null);
  const titles = new Map(lib.projects.map((p) => [p.id, p.title]));
  const byId = new Map(pages.map((p) => [p.id, p]));

  const ask = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    const r = await askNotes(
      question,
      pages.map((p) => ({ id: p.id, title: titles.get(p.projectId ?? "") ?? "", text: p.text })),
    );
    setRes({ question, r });
    setBusy(false);
    update((l) => logEvent(l, "ask", { scope, smart: r.smart, grounded: r.smart || r.grounded }));
  };

  const source = (pageId: string) => {
    const p = byId.get(pageId);
    if (!p) return "";
    const title = titles.get(p.projectId ?? "") ?? "";
    const where = p.pageNumber ? `p. ${p.pageNumber}` : p.sourceName;
    return [title, where].filter(Boolean).join(", ");
  };

  const quotes = res ? (res.r.smart ? res.r.citations : res.r.passages) : [];
  return (
    <section className="rounded-[16px] border-2 border-line p-4" data-testid="ask">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input className="input !py-2.5 min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={label} aria-label={label} />
        <button className="btn btn-sm flex-none" disabled={!q.trim() || busy} aria-label="Ask">
          {busy ? <LoaderCircle size={18} className="animate-spin" /> : <MessageCircleQuestion size={18} strokeWidth={2.5} />} Ask
        </button>
      </form>
      {res && (
        <div className="anim-fade mt-4" aria-live="polite">
          {res.r.smart ? (
            <p className="text-[17px] font-semibold leading-snug">{res.r.answer}</p>
          ) : !res.r.grounded ? (
            <p className="font-bold text-muted">Your notes don&apos;t mention this yet.</p>
          ) : (
            <p className="kicker">{res.r.fallback ? "Your notes don't answer this directly. Closest passages:" : "From your notes"}</p>
          )}
          {quotes.length > 0 && (
            <ul className="mt-3 grid gap-2.5">
              {quotes.map((c, i) => (
                <li key={i} className="rounded-[12px] bg-shelf p-3">
                  <p className="serif text-[16px] leading-snug">{c.text}</p>
                  <p className="mt-1 text-[12px] font-extrabold text-muted">{source(c.pageId)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

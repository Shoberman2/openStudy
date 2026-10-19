"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { genDefMC, genMC, genMatch, genQuoteBank, genQuoteOrder, genTF, type Exercise } from "@/engine/exercises";
import { normalizeLibrary } from "@/engine/library";
import type { Card } from "@/engine/types";
import { seeded } from "@/engine/util";
import { sample } from "@/lib/actions";
import { SessionPlayer, type Source } from "@/components/exercise/SessionPlayer";

const lib = normalizeLibrary(sample, new Date("2026-10-01T00:00:00Z"));
const card = (id: string) => lib.cards.find((c) => c.id === id)!;
const titleOf = (c: Card) => lib.projects.find((p) => p.id === c.projectId)?.title ?? "";

function sourceFor(ex: Exercise): Source | null {
  const c = card(ex.cardIds[0]);
  const page = lib.pages.find((p) => p.id === c.pageId);
  return { book: titleOf(c), header: page?.header, text: page?.text };
}

function Done({ title, onAgain }: { title: string; onAgain: () => void }) {
  return (
    <div className="anim-fade flex min-h-[380px] flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-[24px] font-black">{title}</p>
      <p className="mt-1.5 max-w-[340px] text-muted">That was the real app running on the samples. Bring your own pages, slides or notes and it builds lessons like these.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/app" className="btn">
          Start studying
        </Link>
        <button className="btn btn-secondary" onClick={onAgain}>
          <RotateCcw size={18} strokeWidth={2.5} /> Again
        </button>
      </div>
    </div>
  );
}

function Demo({ make, doneTitle, label }: { make: (seed: number) => Exercise[]; doneTitle: string; label: string }) {
  const [round, setRound] = useState(0);
  const [done, setDone] = useState(false);
  const exercises = useMemo(() => make(round + 1), [make, round]);
  return (
    <div className="card overflow-hidden bg-paper" style={{ boxShadow: "0 6px 0 var(--line)" }} aria-label={label}>
      {done ? (
        <Done
          title={doneTitle}
          onAgain={() => {
            setRound((r) => r + 1);
            setDone(false);
          }}
        />
      ) : (
        <SessionPlayer key={round} mode="embedded" exercises={exercises} sourceFor={sourceFor} onFinish={() => setDone(true)} />
      )}
    </div>
  );
}

const pool = lib.cards.filter((c) => c.projectId === "smpcarnegi");

const bio = lib.cards.filter((c) => c.projectId === "smpbio101");

function heroExercises(seed: number): Exercise[] {
  const rand = seeded(seed * 7919);
  const ctx = { pool, rand };
  const bioCtx = { pool: bio, rand };
  return [
    genMC(card("c04"), ctx),
    genDefMC(card("b03"), bioCtx)!,
    genTF(card("c02"), ctx)!,
    genMatch([card("b06"), card("b07"), card("b08"), card("b09")], bioCtx)!,
  ].filter(Boolean);
}

const aurelius = lib.cards.filter((c) => c.projectId === "smpaurelis");
function quoteExercises(seed: number): Exercise[] {
  const rand = seeded(seed * 104729);
  const ctx = { pool: aurelius, rand };
  return [genQuoteBank(card("q33"), ctx, 3)!, genQuoteOrder(card("q32"), ctx)!, genQuoteBank(card("q34"), ctx, 1)!].filter(Boolean);
}

export function HeroDemo() {
  return <Demo make={heroExercises} doneTitle="Lesson done" label="Live lesson from the samples" />;
}

export function QuotesDemo() {
  return <Demo make={quoteExercises} doneTitle="Three quotes, word for word" label="Live quotes exercise" />;
}

"use client";

import { useState } from "react";
import type { FlashcardsBlock as Flashcards } from "@/engine/tutor/blocks";
import { Prose } from "./Prose";

const seedShuffle = <T,>(list: T[]): T[] => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Flip, mark known or still learning, then go round again on what was missed. */
export function FlashcardsBlock({ block }: { block: Flashcards }) {
  const [queue, setQueue] = useState(block.cards);
  const [at, setAt] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [missed, setMissed] = useState<Flashcards["cards"]>([]);
  const [known, setKnown] = useState(0);
  const card = queue[at];

  const mark = (ok: boolean) => {
    if (ok) setKnown((k) => k + 1);
    else setMissed((m) => [...m, card]);
    setFlipped(false);
    setAt((i) => i + 1);
  };
  const restart = (list: Flashcards["cards"]) => {
    setQueue(list);
    setAt(0);
    setMissed([]);
    setFlipped(false);
    if (list === block.cards) setKnown(0);
  };

  return (
    <section data-testid="flashcards">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[18px] font-semibold text-ink">{block.title}</h3>
        <span className="mono text-[15px] text-muted">{card ? `${at + 1} of ${queue.length}` : `${known} of ${block.cards.length} known`}</span>
      </div>
      {card ? (
        <>
          <button className="flip w-full cursor-pointer rounded-[16px] text-[18px]" aria-label={flipped ? "Card back, tap to flip" : "Card front, tap to flip"} onClick={() => setFlipped((f) => !f)}>
            <span className={`flip-inner ${flipped ? "is-flipped" : ""}`}>
              <span className="flip-face font-medium">
                <Prose text={card.front} />
              </span>
              <span className="flip-face flip-back">
                <Prose text={card.back} />
              </span>
            </span>
          </button>
          <div className="mt-3 flex flex-wrap gap-2">
            {flipped ? (
              <>
                <button className="pill" onClick={() => mark(true)}>Knew it</button>
                <button className="pill pill-ghost" onClick={() => mark(false)}>Still learning</button>
              </>
            ) : (
              <>
                <button className="pill" onClick={() => setFlipped(true)}>Flip</button>
                <button className="pill pill-ghost" onClick={() => restart(seedShuffle(queue))}>Shuffle</button>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {missed.length > 0 && <button className="pill" onClick={() => restart(missed)}>Review {missed.length} missed</button>}
          <button className={`pill ${missed.length ? "pill-ghost" : ""}`} onClick={() => restart(block.cards)}>Start over</button>
        </div>
      )}
    </section>
  );
}

"use client";

import { RotateCcw } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Answer, CheckResult, Exercise, Segment } from "@/engine/exercises";
import { wordCount } from "@/engine/text";
import { PictureFrame, SourceThumb } from "@/components/app/SourceImage";

export type ViewProps = {
  ex: Exercise;
  /** Set once the answer has been checked: locks input and shows right/wrong states. */
  result: CheckResult | null;
  onAnswer: (a: Answer | null) => void;
  /** Ask the player to check now (Enter in a text field, finished match, flash grade). */
  onSubmit: (a?: Answer) => void;
  compact?: boolean;
  /** The source page's image (spec 11.1): shown on reveal, and as the subject of picture exercises. */
  image?: { key?: string; pageNumber?: number };
};

export function instructionFor(ex: Exercise): string {
  switch (ex.type) {
    case "mc":
      return ex.prompt.includes("____") ? "Fill in the blank" : "Choose the right answer";
    case "tf":
      return "True or false?";
    case "bank":
      return "Complete the sentence";
    case "type":
      return ex.prompt.includes("____") ? "Type the missing word" : "Type the answer";
    case "match":
      return "Match the pairs";
    case "flash":
      return "Recall it, then flip";
    case "apply":
      return "How would you use this?";
    case "def-mc":
      return "Pick the definition";
    case "term-type":
      return "Type the term";
    case "explain":
      return "Explain it in your own words";
    case "q-bank1":
    case "q-bank3":
      return "Fill in the quote";
    case "q-order":
      return "Put the quote in order";
    case "q-letters":
      return "Type the quote from its first letters";
    case "q-recall":
      return "Type the quote from memory";
    case "picture":
      return "Recall what this page shows";
  }
}

const isQuote = (ex: Exercise) => ex.type.startsWith("q-");

/** Render "____" in a sentence as a visible blank. */
function WithBlanks({ text }: { text: string }) {
  const parts = text.split("____");
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p}
          {i < parts.length - 1 && <span className="mx-1 inline-block w-16 translate-y-[3px] border-b-[3px] border-[var(--line-strong)]" aria-label="blank" />}
        </Fragment>
      ))}
    </>
  );
}

export function ExerciseView(props: ViewProps) {
  const { ex } = props;
  return (
    <div key={ex.id} className="anim-fade">
      {(() => {
        switch (ex.type) {
          case "mc":
            return <MultipleChoice {...props} ex={ex} />;
          case "tf":
            return <TrueFalse {...props} ex={ex} />;
          case "bank":
          case "q-bank1":
          case "q-bank3":
            return <WordBank {...props} ex={ex} />;
          case "type":
            return <TypeIt {...props} ex={ex} />;
          case "match":
            return <MatchPairs {...props} ex={ex} />;
          case "flash":
            return <Flash {...props} ex={ex} />;
          case "apply":
            return <Apply {...props} ex={ex} />;
          case "def-mc":
            return <DefinitionChoice {...props} ex={ex} />;
          case "term-type":
            return <TermType {...props} ex={ex} />;
          case "explain":
            return <Explain {...props} ex={ex} />;
          case "q-order":
            return <OrderQuote {...props} ex={ex} />;
          case "q-letters":
          case "q-recall":
            return <TypeQuote {...props} ex={ex} />;
          case "picture":
            return <Picture {...props} ex={ex} />;
        }
      })()}
    </div>
  );
}

function Prompt({ children, serif, compact }: { children: ReactNode; serif?: boolean; compact?: boolean }) {
  return (
    <p className={`${serif ? "serif font-medium" : "font-bold"} ${compact ? "text-[19px] sm:text-[21px]" : "text-[21px] sm:text-[24px]"} leading-snug text-ink`}>
      {children}
    </p>
  );
}

function Attribution({ name }: { name?: string }) {
  if (!name) return null;
  return <p className="mt-2 text-[15px] font-bold text-muted">{name}</p>;
}

type P<T extends Exercise["type"]> = Omit<ViewProps, "ex"> & { ex: Extract<Exercise, { type: T }> };

// ---------- Multiple choice ----------
function MultipleChoice({ ex, result, onAnswer, compact }: P<"mc">) {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <Prompt compact={compact}>
        <WithBlanks text={ex.prompt} />
      </Prompt>
      <div className="grid grid-cols-1 gap-2.5">
        {ex.options.map((o, i) => {
          const state = result ? (o === ex.answer ? "is-correct" : o === sel ? "is-wrong" : "") : sel === o ? "is-selected" : "";
          return (
            <button
              key={o}
              disabled={!!result}
              className={`tile ${state} ${result && o === ex.answer && result.verdict !== "wrong" ? "anim-pop" : ""} ${result && o === sel && result.verdict === "wrong" ? "anim-shake" : ""}`}
              onClick={() => {
                setSel(o);
                onAnswer({ kind: "choice", value: o });
              }}
            >
              <KeyHint n={i + 1} />
              <span>{o}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function KeyHint({ n }: { n: number }) {
  return (
    <span className="hidden sm:inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border-2 border-current text-[13px] font-extrabold opacity-40" aria-hidden>
      {n}
    </span>
  );
}

// ---------- True / False ----------
function TrueFalse({ ex, result, onAnswer, compact }: P<"tf">) {
  const [sel, setSel] = useState<boolean | null>(null);
  return (
    <div className="space-y-5">
      <div className="card p-5">
        <Prompt compact={compact}>{ex.statement}</Prompt>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[true, false].map((v) => {
          const state = result ? (v === ex.truth ? "is-correct" : v === sel ? "is-wrong" : "") : sel === v ? "is-selected" : "";
          return (
            <button
              key={String(v)}
              disabled={!!result}
              className={`tile justify-center ${state} ${result && v === sel && result.verdict === "wrong" ? "anim-shake" : ""}`}
              onClick={() => {
                setSel(v);
                onAnswer({ kind: "bool", value: v });
              }}
            >
              {v ? "True" : "False"}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Word bank (facts and quotes) ----------
function WordBank({ ex, result, onAnswer, compact }: P<"bank" | "q-bank1" | "q-bank3">) {
  const n = ex.answers.length;
  const [slots, setSlots] = useState<(number | null)[]>(() => Array(n).fill(null));
  const serif = isQuote(ex);
  const update = (next: (number | null)[]) => {
    setSlots(next);
    onAnswer(next.every((x) => x !== null) ? { kind: "slots", value: next.map((i) => ex.options[i!]) } : null);
  };
  const pick = (oi: number) => {
    if (result || slots.includes(oi)) return;
    const free = slots.indexOf(null);
    if (free < 0) return;
    const next = slots.slice();
    next[free] = oi;
    update(next);
  };
  const clear = (si: number) => {
    if (result || slots[si] === null) return;
    const next = slots.slice();
    next[si] = null;
    update(next);
  };
  const activeSlot = slots.indexOf(null);
  return (
    <div className="space-y-6">
      <div className={serif ? "card p-5 bg-[var(--page-paper)]" : ""}>
        <Prompt serif={serif} compact={compact}>
          {ex.segments.map((s: Segment, i) =>
            typeof s === "string" ? (
              <Fragment key={i}>{s}</Fragment>
            ) : (
              <button
                key={i}
                onClick={() => clear(s.blank)}
                className={`slot ${slots[s.blank] !== null ? "is-filled" : ""} ${activeSlot === s.blank && !result ? "is-active" : ""} ${
                  result ? (result.verdict === "wrong" ? "!text-red !border-red" : "!text-green !border-green") : ""
                } ${serif ? "font-sans" : ""}`}
                aria-label={slots[s.blank] !== null ? `Remove ${ex.options[slots[s.blank]!]}` : "Empty blank"}
              >
                {slots[s.blank] !== null ? ex.options[slots[s.blank]!] : " "}
              </button>
            ),
          )}
        </Prompt>
        {serif && <Attribution name={ex.attribution} />}
      </div>
      <div className="flex flex-wrap gap-2.5">
        {ex.options.map((o, oi) => (
          <button key={oi} disabled={!!result} className={`chip ${slots.includes(oi) ? "is-used" : ""}`} onClick={() => pick(oi)}>
            <span>{o}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Type the answer ----------
function TypeIt({ ex, result, onAnswer, onSubmit, compact }: P<"type">) {
  const [v, setV] = useState("");
  const [startedAt] = useState(() => Date.now());
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!compact) ref.current?.focus({ preventScroll: true });
  }, [compact]);
  const ans = (val: string): Answer | null => (val.trim() ? { kind: "text", value: val, ms: Date.now() - startedAt } : null);
  return (
    <div className="space-y-5">
      <Prompt compact={compact}>
        <WithBlanks text={ex.prompt} />
      </Prompt>
      <input
        ref={ref}
        className={`input ${result ? (result.verdict === "wrong" ? "!border-red" : "!border-green") : ""}`}
        value={v}
        disabled={!!result}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="Type your answer"
        aria-label="Your answer"
        onChange={(e) => {
          setV(e.target.value);
          onAnswer(ans(e.target.value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v.trim() && !result) {
            e.preventDefault();
            e.stopPropagation();
            onSubmit(ans(v)!);
          }
        }}
      />
    </div>
  );
}

// ---------- Match pairs ----------
function MatchPairs({ ex, result, onSubmit }: P<"match">) {
  const [term, setTerm] = useState<string | null>(null);
  const [clue, setClue] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [wrong, setWrong] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const byKey = useMemo(() => new Map(ex.pairs.map((p) => [p.key, p])), [ex.pairs]);

  const tryPair = (t: string | null, c: string | null) => {
    if (!t || !c) return;
    if (t === c) {
      const next = [...done, t];
      setDone(next);
      setTerm(null);
      setClue(null);
      if (next.length === ex.pairs.length) setTimeout(() => onSubmit({ kind: "match", mistakes }), 260);
    } else {
      setMistakes((m) => m + 1);
      setWrong([`t${t}`, `c${c}`]);
      setTimeout(() => {
        setWrong([]);
        setTerm(null);
        setClue(null);
      }, 380);
    }
  };
  const cls = (side: "t" | "c", key: string, sel: string | null) =>
    `tile ${done.includes(key) ? "is-done is-correct" : wrong.includes(side + key) ? "is-wrong anim-shake" : sel === key ? "is-selected" : ""}`;
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] gap-2.5">
      <div className="grid content-start gap-2.5">
        {ex.terms.map((k) => (
          <button
            key={k}
            disabled={done.includes(k) || !!result}
            className={`${cls("t", k, term)} justify-center text-center !min-h-[72px]`}
            onClick={() => {
              setTerm(k);
              tryPair(k, clue);
            }}
          >
            {byKey.get(k)!.term}
          </button>
        ))}
      </div>
      <div className="grid content-start gap-2.5">
        {ex.clues.map((k) => (
          <button
            key={k}
            disabled={done.includes(k) || !!result}
            className={`${cls("c", k, clue)} !min-h-[72px] !text-[15px] !font-semibold !leading-snug`}
            onClick={() => {
              setClue(k);
              tryPair(term, k);
            }}
          >
            {byKey.get(k)!.clue}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Flashcard ----------
function Flash({ ex, result, onSubmit, compact, image }: P<"flash">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-5">
      <div className="card p-6 min-h-[180px] flex flex-col justify-center">
        <Prompt compact={compact}>
          <WithBlanks text={ex.front} />
        </Prompt>
        {shown && (
          <div className="anim-fade mt-5 border-t-2 border-line pt-4">
            <p className="text-[22px] font-black text-blue">{ex.back}</p>
            {ex.detail && <p className="serif mt-2 text-[17px] text-muted">{ex.detail}</p>}
            <SourceThumb imageKey={image?.key} pageNumber={image?.pageNumber} className="mt-4" />
          </div>
        )}
      </div>
      {!shown ? (
        <button className="btn btn-secondary btn-block" onClick={() => setShown(true)}>
          <RotateCcw size={18} strokeWidth={2.5} /> Show answer
        </button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {(["again", "hard", "good", "easy"] as const).map((g) => (
            <button key={g} disabled={!!result} className={`btn btn-sm ${g === "again" ? "btn-red" : g === "hard" ? "btn-yellow" : g === "good" ? "btn-green" : ""}`} onClick={() => onSubmit({ kind: "flash", grade: g })}>
              {g[0].toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Apply ----------
function Apply({ ex, result, onAnswer, compact }: P<"apply">) {
  const [v, setV] = useState("");
  return (
    <div className="space-y-5">
      <div className="card p-5 bg-[var(--page-paper)]">
        <p className="serif text-[19px] leading-snug">{ex.statement}</p>
      </div>
      <Prompt compact={compact}>Where could you use this in the next week?</Prompt>
      <textarea
        className="input min-h-[120px] resize-none"
        value={v}
        disabled={!!result}
        placeholder="A sentence or two is plenty"
        aria-label="Your answer"
        onChange={(e) => {
          setV(e.target.value);
          onAnswer(wordCount(e.target.value) >= 4 ? { kind: "text", value: e.target.value } : null);
        }}
      />
      <p className="text-[14px] text-muted">Four words or more. Worth 3 XP.</p>
    </div>
  );
}

// ---------- Definition choice ----------
function DefinitionChoice({ ex, result, onAnswer, compact }: P<"def-mc">) {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <Prompt compact={compact}>
        What does <span className="text-blue">{ex.term}</span> mean?
      </Prompt>
      <div className="grid grid-cols-1 gap-2.5">
        {ex.options.map((o, i) => {
          const state = result ? (o === ex.answer ? "is-correct" : o === sel ? "is-wrong" : "") : sel === o ? "is-selected" : "";
          return (
            <button
              key={o}
              disabled={!!result}
              className={`tile !items-start !text-[16px] !font-semibold !leading-snug ${state} ${result && o === sel && result.verdict === "wrong" ? "anim-shake" : ""}`}
              onClick={() => {
                setSel(o);
                onAnswer({ kind: "choice", value: o });
              }}
            >
              <KeyHint n={i + 1} />
              <span>{o}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Type the term ----------
function TermType({ ex, result, onAnswer, onSubmit, compact }: P<"term-type">) {
  const [v, setV] = useState("");
  const [startedAt] = useState(() => Date.now());
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!compact) ref.current?.focus({ preventScroll: true });
  }, [compact]);
  const ans = (val: string): Answer | null => (val.trim() ? { kind: "text", value: val, ms: Date.now() - startedAt } : null);
  return (
    <div className="space-y-5">
      <div className="card p-5">
        <p className="kicker mb-1.5">Definition</p>
        <Prompt compact={compact}>{ex.definition}</Prompt>
      </div>
      <input
        ref={ref}
        className={`input ${result ? (result.verdict === "wrong" ? "!border-red" : "!border-green") : ""}`}
        value={v}
        disabled={!!result}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="The term"
        aria-label="Your answer"
        onChange={(e) => {
          setV(e.target.value);
          onAnswer(ans(e.target.value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v.trim() && !result) {
            e.preventDefault();
            e.stopPropagation();
            onSubmit(ans(v)!);
          }
        }}
      />
    </div>
  );
}

// ---------- Explain (Feynman) ----------
function Explain({ ex, result, onSubmit, compact, image }: P<"explain">) {
  const [v, setV] = useState("");
  const [compare, setCompare] = useState(false);
  const n = wordCount(v);
  return (
    <div className="space-y-5">
      <Prompt compact={compact}>
        Explain <span className="text-blue">{ex.topic}</span> in your own words, like you&apos;re teaching a friend.
      </Prompt>
      <textarea
        className="input min-h-[140px] resize-none"
        value={v}
        disabled={compare || !!result}
        placeholder="Write it the way you would say it out loud"
        aria-label="Your explanation"
        onChange={(e) => setV(e.target.value)}
      />
      {!compare ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[14px] font-bold text-muted">{n < 12 ? `${12 - n} more word${12 - n === 1 ? "" : "s"}` : "Ready to compare"}</p>
          <button className="btn btn-sm" disabled={n < 12} onClick={() => setCompare(true)}>
            Compare with the source
          </button>
        </div>
      ) : (
        <div className="anim-fade space-y-4">
          <div className="card bg-[var(--page-paper)] p-5">
            <p className="kicker mb-1.5">From your material</p>
            {ex.sources.map((t) => (
              <p key={t} className="serif text-[18px] leading-snug">
                {t}
              </p>
            ))}
            <SourceThumb imageKey={image?.key} pageNumber={image?.pageNumber} className="mt-4" />
          </div>
          <p className="font-extrabold">How close were you?</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["good", "Got it", "btn-green"],
                ["hard", "Partly", "btn-yellow"],
                ["again", "Missed it", "btn-red"],
              ] as const
            ).map(([g, label, cls]) => (
              <button key={g} disabled={!!result} className={`btn btn-sm ${cls}`} onClick={() => onSubmit({ kind: "rate", grade: g })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Picture card (spec 11.2) ----------
function Picture({ ex, result, onSubmit, compact, image }: P<"picture">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-5">
      <PictureFrame imageKey={image?.key} />
      <Prompt compact={compact}>{ex.prompt}</Prompt>
      {!shown ? (
        <button className="btn btn-secondary btn-block" onClick={() => setShown(true)}>
          <RotateCcw size={18} strokeWidth={2.5} /> Show me
        </button>
      ) : (
        <div className="anim-fade space-y-4">
          <div className="card bg-[var(--page-paper)] p-5">
            <p className="kicker mb-1.5">On this page</p>
            <p className="serif text-[18px] leading-snug whitespace-pre-line">{ex.reveal}</p>
          </div>
          <p className="font-extrabold">How much did you remember?</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["good", "Got it", "btn-green"],
                ["hard", "Partly", "btn-yellow"],
                ["again", "Missed it", "btn-red"],
              ] as const
            ).map(([g, label, cls]) => (
              <button key={g} disabled={!!result} className={`btn btn-sm ${cls}`} onClick={() => onSubmit({ kind: "rate", grade: g })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Order the quote ----------
function OrderQuote({ ex, result, onAnswer }: P<"q-order">) {
  const [picked, setPicked] = useState<number[]>([]);
  const update = (next: number[]) => {
    setPicked(next);
    onAnswer(next.length === ex.chunks.length ? { kind: "order", value: next } : null);
  };
  return (
    <div className="space-y-6">
      <div className={`card min-h-[132px] p-4 bg-[var(--page-paper)] ${result ? (result.verdict === "wrong" ? "!border-red" : "!border-green") : ""}`}>
        <div className="flex flex-wrap gap-2">
          {picked.map((ci) => (
            <button key={ci} disabled={!!result} className="chip chip-serif" onClick={() => update(picked.filter((x) => x !== ci))}>
              {ex.chunks[ci]}
            </button>
          ))}
          {!picked.length && <p className="serif px-1 py-2 text-[18px] text-muted">Tap the pieces in order</p>}
        </div>
        <Attribution name={ex.attribution} />
      </div>
      <div className="flex flex-wrap gap-2.5">
        {ex.shuffled.map((ci) => (
          <button key={ci} disabled={!!result} className={`chip chip-serif ${picked.includes(ci) ? "is-used" : ""}`} onClick={() => !picked.includes(ci) && update([...picked, ci])}>
            <span>{ex.chunks[ci]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Type the quote ----------
function TypeQuote({ ex, result, onAnswer }: P<"q-letters" | "q-recall">) {
  const [v, setV] = useState("");
  const [startedAt] = useState(() => Date.now());
  return (
    <div className="space-y-5">
      <div className="card p-5 bg-[var(--page-paper)]">
        {ex.type === "q-letters" ? (
          <p className="serif text-[21px] leading-relaxed tracking-wide break-words">{ex.hint}</p>
        ) : (
          <p className="serif text-[21px] leading-relaxed">
            <span className="text-muted">Starts with</span> {ex.starts}
            <span className="text-muted">{"…"}</span>
          </p>
        )}
        <Attribution name={ex.attribution} />
      </div>
      <textarea
        className={`input serif !font-medium !text-[19px] min-h-[120px] resize-none ${result ? (result.verdict === "wrong" ? "!border-red" : "!border-green") : ""}`}
        value={v}
        disabled={!!result}
        placeholder="Type the full quote"
        aria-label="The quote"
        autoCapitalize="sentences"
        spellCheck={false}
        onChange={(e) => {
          setV(e.target.value);
          onAnswer(e.target.value.trim() ? { kind: "text", value: e.target.value, ms: Date.now() - startedAt } : null);
        }}
      />
    </div>
  );
}


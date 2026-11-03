"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EMPTY_MASTERY, MAX_ATTEMPTS, readAttempts, type Attempt } from "@/engine/tutor/adaptive";
import type { RenderBlock } from "@/engine/tutor/blocks";
import type { ChatReply } from "@/engine/tutor/service";
import { Logo } from "@/components/ui/basics";
import { DiagramBlock } from "./DiagramBlock";
import { FlashcardsBlock } from "./FlashcardsBlock";
import { PlotBlock } from "./PlotBlock";
import { Formula, Line, Prose } from "./Prose";
import { QuizBlock } from "./QuizBlock";
import { StepsBlock } from "./StepsBlock";

const KEY = "openstudy-mastery-v1";

const STARTERS = [
  { label: "Plot a sine wave I can change", prompt: "plot a*sin(b*x + c)" },
  { label: "Explain quadratic functions", prompt: "Explain quadratic functions with a visual" },
  { label: "How compound interest grows", prompt: "Show me how compound interest grows" },
  { label: "Quiz me on photosynthesis", prompt: "Quiz me on photosynthesis" },
];

type Turn = { role: "user"; text: string } | { role: "assistant"; reply: ChatReply };

function plainText(t: Turn): string {
  if (t.role === "user") return t.text;
  return t.reply.blocks.map((b) => (b.type === "text" ? b.markdown : "title" in b ? `[${b.type}: ${b.title}]` : "")).filter(Boolean).join("\n");
}

function Block({ b, attempts, onAttempt, onAsk }: { b: RenderBlock; attempts: Attempt[]; onAttempt: (a: Attempt) => void; onAsk: (p: string) => void }) {
  switch (b.type) {
    case "text":
      return <Prose text={b.markdown} />;
    case "formula":
      return (
        <div>
          <Formula latex={b.latex} />
          {b.caption && <p className="text-center text-[15px] text-muted"><Line text={b.caption} /></p>}
        </div>
      );
    case "followups":
      return (
        <div className="flex flex-wrap gap-2">
          {b.items.map((f) => (
            <button key={f.label} className="pill pill-ghost" onClick={() => onAsk(f.prompt)}>{f.label}</button>
          ))}
        </div>
      );
    case "plot":
      return <div className="reply-card"><PlotBlock block={b} /></div>;
    case "diagram":
      return <div className="reply-card"><DiagramBlock block={b} /></div>;
    case "steps":
      return <div className="reply-card"><StepsBlock block={b} /></div>;
    case "flashcards":
      return <div className="reply-card"><FlashcardsBlock block={b} /></div>;
    case "quiz":
      return <div className="reply-card"><QuizBlock block={b} attempts={attempts} onAttempt={onAttempt} onAsk={onAsk} /></div>;
  }
}

export function ChatView() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>(EMPTY_MASTERY.attempts);
  const end = useRef<HTMLDivElement>(null);
  const latest = useRef({ turns, attempts });
  useEffect(() => {
    latest.current = { turns, attempts };
  }, [turns, attempts]);

  useEffect(() => {
    try {
      // Loaded after mount: localStorage does not exist during server rendering.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAttempts(readAttempts(JSON.parse(localStorage.getItem(KEY) ?? "[]")));
    } catch {
      /* A bad value starts fresh. */
    }
  }, []);

  useEffect(() => {
    if (turns.length) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);

  const onAttempt = useCallback((a: Attempt) => {
    setAttempts((list) => {
      const next = [...list, a].slice(-MAX_ATTEMPTS);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* Private mode: mastery lasts this session only. */
      }
      return next;
    });
  }, []);

  const ask = useCallback(async (prompt: string) => {
    const q = prompt.trim();
    if (!q) return;
    const history: Turn[] = [...latest.current.turns, { role: "user", text: q }];
    setTurns(history);
    setText("");
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.map((t) => ({ role: t.role, text: plainText(t) })), attempts: latest.current.attempts }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const reply = (await r.json()) as ChatReply;
      setTurns((t) => [...t, { role: "assistant", reply }]);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  const notice = turns.findLast((t): t is Extract<Turn, { role: "assistant" }> => t.role === "assistant")?.reply.notice;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[760px] items-center justify-between px-4">
          <Logo href="/app" />
          <Link href="/app" className="pill pill-ghost no-underline">Your shelf</Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[760px] flex-1 px-4 pb-6 pt-4">
        {!turns.length && (
          <div className="mt-[10vh] text-center">
            <h1 className="display text-[clamp(32px,6vw,52px)] text-ink">What Are You Learning?</h1>
            <p className="mx-auto mt-3 max-w-[46ch] text-muted">Ask about anything. Answers come with graphs you can change, worked steps and quizzes.</p>
            <div className="mx-auto mt-6 flex max-w-[560px] flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button key={s.label} className="pill pill-ghost" onClick={() => void ask(s.prompt)}>{s.label}</button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="user-bubble text-[17px]">{t.text}</p>
              </div>
            ) : (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)] gap-4" data-testid="reply">
                {t.reply.blocks.map((b, j) => (
                  <Block key={j} b={b} attempts={attempts} onAttempt={onAttempt} onAsk={(p) => void ask(p)} />
                ))}
              </div>
            ),
          )}
          {busy && (
            <p className="text-[16px] text-muted" aria-live="polite">
              <span className="animate-pulse">Working on it</span>
            </p>
          )}
          {failed && (
            <p className="text-[16px] text-red" role="alert">
              That did not go through. Check your connection and send it again.
            </p>
          )}
        </div>
        <div ref={end} />
      </main>

      <div className="sticky bottom-0 bg-paper/90 backdrop-blur">
        <div className="mx-auto w-full max-w-[760px] px-4 pb-4 pt-2">
          {notice && <p className="mb-2 text-[14px] text-muted" data-testid="demo-notice">{notice}</p>}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void ask(text);
            }}
          >
            <input className="input min-w-0 flex-1 !rounded-full !py-2.5" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about anything" aria-label="Your question" maxLength={2000} />
            <button className="pill flex-none" disabled={busy || !text.trim()}>Send</button>
          </form>
        </div>
      </div>
    </div>
  );
}

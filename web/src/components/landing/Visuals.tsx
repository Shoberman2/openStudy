"use client";

import { BookOpen, ClipboardCheck, RefreshCw } from "lucide-react";
import { useState } from "react";
import { BookSpine, PathNode, ZIGZAG } from "@/components/ui/basics";

/**
 * iPhone frame sized to the iPhone 16 Pro screen (1206x2622 screenshots), so a real simulator
 * screenshot fits exactly with nothing cropped. Real screenshots already contain the status bar and
 * Dynamic Island, so the drawn island only appears on the placeholder.
 */
export function IPhoneFrame({ src, alt, width = 290 }: { src: string | null; alt: string; width?: number }) {
  const [failed, setFailed] = useState(false);
  const show = !!src && !failed;
  const bezel = Math.round(width * 0.036);
  const screenW = width - bezel * 2;
  const screenH = Math.round((screenW * 2622) / 1206);
  const radius = Math.round(screenW * 0.135);
  return (
    <div
      className="relative flex-none bg-[#0b0b0c]"
      style={{ width, height: screenH + bezel * 2, padding: bezel, borderRadius: radius + bezel, boxShadow: "0 0 0 2px var(--line-strong), 0 8px 0 var(--line)" }}
    >
      <div className="relative overflow-hidden bg-paper" style={{ width: screenW, height: screenH, borderRadius: radius }}>
        {show ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} width={1206} height={2622} className="block h-full w-full" onError={() => setFailed(true)} />
        ) : (
          <>
            <MiniPath />
            <div className="absolute left-1/2 top-[3%] h-[3.6%] w-[31%] -translate-x-1/2 rounded-full bg-[#0b0b0c]" aria-hidden />
          </>
        )}
      </div>
    </div>
  );
}

function MiniPath() {
  const nodes = [
    { title: "Handling People", level: 3, kind: "theme" as const, locked: false },
    { title: "Quotes", level: 1, kind: "quotes" as const, locked: false },
    { title: "Being Liked", level: 1, kind: "theme" as const, locked: false },
    { title: "Winning Agreement", level: 0, kind: "theme" as const, locked: false },
    { title: "Leading", level: 0, kind: "theme" as const, locked: true },
  ];
  return (
    <div className="flex h-full flex-col bg-paper pt-[54px]" aria-label="Lesson path on iPhone">
      <div className="px-5">
        <p className="text-[11px] font-extrabold text-muted">Dale Carnegie</p>
        <p className="text-[17px] font-black leading-tight">How to Win Friends</p>
      </div>
      <div className="mt-6 flex flex-col items-center gap-5" aria-hidden>
        {nodes.map((n, i) => (
          <div key={n.title} className="flex flex-col items-center" style={{ transform: `translateX(${ZIGZAG[i] * 0.55}px)` }}>
            <div className="pointer-events-none">
              <PathNode level={n.level} kind={n.kind} locked={n.locked} size={50} label={n.title} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A page rendered the way Apple Books shows it. */
export function BooksPage({ header, text, page }: { header: string; text: string; page: string }) {
  return (
    <div className="relative mx-auto flex aspect-[9/16] w-full max-w-[220px] flex-col rounded-[22px] border-2 border-line bg-[var(--page-paper)] px-5 pb-4 pt-5" style={{ boxShadow: "0 5px 0 var(--line)" }}>
      <p className="truncate text-center text-[10px] font-semibold text-muted">{header}</p>
      <p className="serif mt-4 flex-1 overflow-hidden text-[13.5px] leading-[1.55] text-ink">{text}</p>
      <p className="mt-2 text-center text-[10px] font-semibold text-muted">{page}</p>
    </div>
  );
}

export function ShelfVisual() {
  const books = [
    { title: "Meditations", author: "Marcus Aurelius", color: "red" as const, h: 176 },
    { title: "How to Win Friends", author: "Dale Carnegie", color: "blue" as const, h: 200 },
    { title: "BIO 101: Cell Biology", author: "", color: "green" as const, h: 210, type: "class" as const, lift: true },
    { title: "Spanish Verbs", author: "", color: "ink" as const, h: 184, type: "other" as const },
  ];
  return (
    <div className="mx-auto w-full max-w-[260px]">
      <div className="flex items-end justify-center gap-2 px-2">
        {books.map((b) => (
          <div key={b.title} style={{ transform: b.lift ? "translateY(-14px)" : undefined }}>
            <BookSpine project={b} height={b.h} />
          </div>
        ))}
      </div>
      <div className="shelf-board" />
    </div>
  );
}

export function PathVisual() {
  const nodes = [
    { t: "Handling People", level: 2, kind: "theme" as const },
    { t: "Quotes", level: 1, kind: "quotes" as const },
    { t: "Being Liked", level: 0, kind: "theme" as const },
  ];
  return (
    <div className="mx-auto flex w-full max-w-[260px] flex-col items-center gap-3" aria-hidden>
      {nodes.map((n, i) => (
        <div key={n.t} className="flex flex-col items-center" style={{ transform: `translateX(${[0, 46, 0][i]}px)` }}>
          <div className="pointer-events-none">
            <PathNode level={n.level} kind={n.kind} locked={false} size={56} label={n.t} />
          </div>
          <p className="mt-1 text-[13px] font-extrabold">{n.t}</p>
        </div>
      ))}
    </div>
  );
}

/** A lecture slide, rendered as HTML. */
export function SlideCard() {
  return (
    <div className="aspect-[16/10] w-full max-w-[260px] overflow-hidden rounded-[14px] border-2 border-line bg-paper" style={{ boxShadow: "0 5px 0 var(--line)" }}>
      <div className="h-2 bg-green" />
      <div className="px-4 pb-3 pt-3">
        <p className="text-[10px] font-extrabold text-muted">BIO 101, Lecture 2</p>
        <p className="mt-0.5 text-[16px] font-black leading-tight">The Cell Membrane</p>
        <ul className="mt-2 grid grid-cols-1 gap-1 text-[11px] font-semibold leading-snug text-ink/85">
          <li className="flex gap-1.5">
            <span className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full bg-green" />
            Phospholipid bilayer controls what enters and leaves
          </li>
          <li className="flex gap-1.5">
            <span className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full bg-green" />
            Osmosis: diffusion of water across a membrane
          </li>
          <li className="flex gap-1.5">
            <span className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full bg-green" />
            Active transport requires ATP
          </li>
        </ul>
      </div>
    </div>
  );
}

/** A photo of a whiteboard, rendered as HTML (board, frame, marker handwriting). */
export function WhiteboardPhoto() {
  return (
    <div className="w-full max-w-[250px] rounded-[10px] bg-[#9aa0a6] p-[7px]" style={{ boxShadow: "0 5px 0 var(--line)" }}>
      <div className="relative rounded-[4px] bg-[#f6f7f4] px-4 pb-4 pt-3 text-[#1d3fa0]" style={{ fontFamily: "var(--font-hand), 'Bradley Hand', cursive" }}>
        <p className="text-[24px] font-bold leading-none" style={{ transform: "rotate(-2deg)" }}>
          Organelles
        </p>
        <div className="mt-1 h-[2px] w-24 rounded bg-[#1d3fa0]/70" style={{ transform: "rotate(-2deg)" }} />
        <p className="mt-2 text-[17px] font-semibold leading-[1.15]" style={{ transform: "rotate(-1deg)" }}>
          Mitochondria = makes ATP
        </p>
        <p className="mt-1 text-[17px] font-semibold leading-[1.15]">Ribosome = builds proteins</p>
        <p className="mt-1 text-[17px] font-semibold leading-[1.15] text-[#c0392b]" style={{ transform: "rotate(1deg)" }}>
          Nucleus holds the DNA!
        </p>
        <span className="absolute bottom-2 right-3 flex h-2 items-stretch overflow-hidden rounded-[3px]" aria-hidden>
          <span className="w-6 bg-[#e9e9e6] ring-1 ring-[#b9bdc1]" />
          <span className="w-2.5 bg-[#1d3fa0]" />
        </span>
      </div>
    </div>
  );
}

export function SourcesStack({ bookText }: { bookText: string }) {
  return (
    <div className="relative mx-auto h-[380px] w-full max-w-[300px]" aria-label="A book page, a lecture slide and a whiteboard photo">
      <div className="absolute left-0 top-0 w-[190px]" style={{ transform: "rotate(-5deg)" }}>
        <BooksPage header="Six Ways to Make People Like You" page="48 of 291" text={bookText} />
      </div>
      <div className="absolute right-0 top-[120px] w-[230px]" style={{ transform: "rotate(3deg)" }}>
        <SlideCard />
      </div>
      <div className="absolute bottom-0 left-[18px] w-[230px]" style={{ transform: "rotate(-2deg)" }}>
        <WhiteboardPhoto />
      </div>
    </div>
  );
}

export function PlanVisual() {
  const rows = [
    { t: "Review 12 cards", s: "Spaced review", m: 4, tone: "bg-green-soft text-green", Icon: RefreshCw },
    { t: "Membranes", s: "BIO 101: Cell Biology", m: 4, tone: "bg-blue-soft text-blue", Icon: BookOpen },
    { t: "Being Liked", s: "How to Win Friends", m: 4, tone: "bg-blue-soft text-blue", Icon: BookOpen },
    { t: "Practice test", s: "BIO 101: Cell Biology", m: 8, tone: "bg-yellow-soft text-[var(--yellow-lip)]", Icon: ClipboardCheck },
  ];
  return (
    <div className="card w-full max-w-[290px] p-4" style={{ boxShadow: "0 5px 0 var(--line)" }}>
      <div className="flex items-baseline justify-between px-1">
        <p className="text-[17px] font-black">Today&apos;s plan</p>
        <p className="text-[12px] font-extrabold text-red">Exam in 10 days</p>
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-1">
        {rows.map((r) => (
          <li key={r.t} className="flex items-center gap-2.5 rounded-[12px] px-1 py-1.5">
            <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-[10px] ${r.tone}`}>
              <r.Icon size={16} strokeWidth={2.5} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-extrabold">{r.t}</span>
              <span className="block truncate text-[11px] font-semibold text-muted">{r.s}</span>
            </span>
            <span className="text-[11px] font-extrabold text-muted">{r.m} min</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import katex from "katex";
import { Fragment, useMemo } from "react";
import { inline, prose, type Inline } from "@/engine/tutor/prose";

/** KaTeX escapes its input and trust is off, so this HTML is safe to inject. */
function Math({ latex, display }: { latex: string; display?: boolean }) {
  const html = useMemo(() => katex.renderToString(latex, { displayMode: !!display, throwOnError: false, trust: false, strict: "ignore" }), [latex, display]);
  return <span className={display ? "block min-w-0" : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Run({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p.k === "text" && p.v}
          {p.k === "bold" && <strong className="font-bold text-ink"><Run parts={inline(p.v)} /></strong>}
          {p.k === "code" && <code className="mono rounded-[6px] bg-shelf px-1.5 py-0.5 text-[15px]">{p.v}</code>}
          {p.k === "math" && <Math latex={p.v} />}
        </Fragment>
      ))}
    </>
  );
}

/** One line of tutor text with math, for stems, options and labels. */
export function Line({ text }: { text: string }) {
  return <Run parts={inline(text)} />;
}

export function Formula({ latex }: { latex: string }) {
  return (
    <div className="prose-math">
      <Math latex={latex} display />
    </div>
  );
}

export function Prose({ text }: { text: string }) {
  const paras = useMemo(() => prose(text), [text]);
  return (
    <div className="prose-math grid gap-3 text-[17px] leading-[1.55]">
      {paras.map((p, i) => {
        if (p.k === "p")
          return (
            <p key={i}>
              <Run parts={p.inline} />
            </p>
          );
        if (p.k === "math") return <Math key={i} latex={p.latex} display />;
        const Tag = p.k;
        return (
          <Tag key={i} className={`grid gap-1 pl-6 ${p.k === "ul" ? "list-disc" : "list-decimal"}`}>
            {p.items.map((it, j) => (
              <li key={j}>
                <Run parts={it} />
              </li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}

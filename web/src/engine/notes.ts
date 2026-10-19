// Notes app text parsing (spec 3.2).
import { wordCount } from "./text";

export type ParsedExcerpt = {
  text: string;
  suggestedTitle?: string;
  suggestedAuthor?: string;
  /** True when the excerpt came with an Apple Books "Excerpt From" footer (verbatim). */
  verbatim: boolean;
};

const FOOTER_RE =
  /\n?[ \t]*Excerpt From[ \t]*\n+[ \t]*([^\n]+?)[ \t]*\n+(?:[ \t]*([^\n]+?)[ \t]*\n+)?[ \t]*This material may be protected by copyright\.?[ \t]*/gi;

function cleanExcerpt(s: string): string {
  return s
    .replace(/\r/g, "")
    .trim()
    .replace(/^[“"]+/, "")
    .replace(/[”"]+$/, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

export function stripHtml(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|blockquote)\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)));
}

function splitPlain(text: string): ParsedExcerpt[] {
  const blocks = text
    .replace(/\r/g, "")
    .split(/\n\s*\n|\n(?=\s*(?:[-*•]|\d+[.)])\s)/)
    .map((b) => b.trim())
    .filter(Boolean);
  let title: string | undefined;
  const out: ParsedExcerpt[] = [];
  blocks.forEach((b, i) => {
    const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
    if (i === 0 && lines.length && lines[0].length < 60 && !/[.!?]$/.test(lines[0])) {
      title = lines[0].replace(/^#+\s*/, "");
      lines.shift();
    }
    const body = lines
      .map((l) => l.replace(/^(?:[-*•]|\d+[.)])\s+/, ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (body && wordCount(body) >= 3) out.push({ text: body, verbatim: false });
  });
  return out.map((e) => ({ ...e, suggestedTitle: title }));
}

/** Parse a pasted blob. Splits on Apple Books footers; falls back to paragraphs. */
export function parseNotes(input: string): ParsedExcerpt[] {
  const text = input.replace(/\r\n?/g, "\n");
  const out: ParsedExcerpt[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  FOOTER_RE.lastIndex = 0;
  let found = false;
  while ((m = FOOTER_RE.exec(text))) {
    found = true;
    const body = cleanExcerpt(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (!body) continue;
    out.push({
      text: body.replace(/\s*\n\s*/g, " "),
      suggestedTitle: m[1].trim(),
      suggestedAuthor: m[2]?.trim() || undefined,
      verbatim: true,
    });
  }
  const rest = text.slice(last).trim();
  if (!found) return splitPlain(text);
  if (rest) out.push(...splitPlain(rest));
  return out;
}

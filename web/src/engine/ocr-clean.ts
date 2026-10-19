// Turns OCR lines (with geometry) into a page body + header (spec 3.1).
import { wordCount } from "./text";

export type OcrLine = { text: string; top: number; bottom: number };

export type CleanedPage = {
  header?: string;
  text: string;
  skipped: boolean;
  reason?: "short" | "not-text";
};

const STATUS_NOISE = [
  /^\d{1,2}:\d{2}/,
  /%$/,
  /\b(LTE|5G|4G|3G|5GE|Wi-?Fi)\b/i,
  /\b(AT&T|Verizon|T-Mobile|Vodafone|EE|O2)\b/,
];

const FOOTER_NOISE = [/^\d+$/, /\bof\s+\d+\b/i, /pages? left/i, /^page\s+\d+/i];

function isNoise(t: string): boolean {
  const s = t.trim();
  if (s.length < 3) return true;
  return STATUS_NOISE.some((r) => r.test(s));
}

export function joinLines(lines: string[]): string {
  let out = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      out = out.trimEnd() + "\n\n";
      continue;
    }
    if (/[A-Za-z]-$/.test(out)) out = out.slice(0, -1) + line;
    else out = out && !out.endsWith("\n") ? out + " " + line : out + line;
  }
  return out
    .split(/\n\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function isBookText(body: string): { ok: boolean; reason?: "short" | "not-text" } {
  const toks = body.split(/\s+/).filter(Boolean);
  if (wordCount(body) < 40) return { ok: false, reason: "short" };
  const alpha = toks.filter((t) => /^[\p{L}][\p{L}'’-]*[.,;:!?"”)]*$/u.test(t.replace(/^["“(]/, ""))).length;
  if (alpha / toks.length < 0.6) return { ok: false, reason: "not-text" };
  return { ok: true };
}

export function cleanOcr(lines: OcrLine[], imageHeight: number): CleanedPage {
  const headerLimit = imageHeight * 0.09;
  const footerLimit = imageHeight * 0.93;
  const headerParts: string[] = [];
  const body: string[] = [];
  const sorted = lines.slice().sort((a, b) => a.top - b.top);
  for (const l of sorted) {
    const t = l.text.replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (l.top >= footerLimit) continue;
    if (isNoise(t)) continue;
    if (l.top < headerLimit) {
      if (!FOOTER_NOISE.some((r) => r.test(t))) headerParts.push(t);
      continue;
    }
    body.push(t);
  }
  const text = joinLines(body);
  const header = headerParts.join(" ").trim() || undefined;
  const check = isBookText(text);
  return { header, text, skipped: !check.ok, reason: check.reason };
}

// A very small markdown reader for tutor text (spec 15.2): paragraphs, lists, bold, code and $math$.
// It produces tokens, never HTML, so model text cannot inject markup. Web and MCP widget share it.

export type Inline = { k: "text" | "bold" | "code"; v: string } | { k: "math"; v: string; display?: boolean };
export type Para = { k: "p"; inline: Inline[] } | { k: "ul" | "ol"; items: Inline[][] } | { k: "math"; latex: string };

/**
 * Inline math follows the pandoc rule, so prices stay prices: the opening $ has a non-space after it,
 * the closing $ has a non-space before it and no digit after it.
 */
const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/g;

export function inline(src: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of src.matchAll(INLINE)) {
    if (m.index > at) out.push({ k: "text", v: src.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ k: "bold", v: m[1] });
    else if (m[2] !== undefined) out.push({ k: "code", v: m[2] });
    else out.push({ k: "math", v: m[3] });
    at = m.index + m[0].length;
  }
  if (at < src.length) out.push({ k: "text", v: src.slice(at) });
  return out;
}

export function prose(src: string): Para[] {
  const out: Para[] = [];
  for (const raw of src.trim().split(/\n\s*\n/)) {
    const block = raw.trim();
    const display = /^\$\$([\s\S]+)\$\$$/.exec(block);
    if (display) {
      out.push({ k: "math", latex: display[1].trim() });
      continue;
    }
    const lines = block.split("\n").map((l) => l.trim());
    if (lines.every((l) => /^[-*]\s+/.test(l))) out.push({ k: "ul", items: lines.map((l) => inline(l.replace(/^[-*]\s+/, ""))) });
    else if (lines.every((l) => /^\d+[.)]\s+/.test(l))) out.push({ k: "ol", items: lines.map((l) => inline(l.replace(/^\d+[.)]\s+/, ""))) });
    else out.push({ k: "p", inline: inline(lines.join(" ")) });
  }
  return out;
}

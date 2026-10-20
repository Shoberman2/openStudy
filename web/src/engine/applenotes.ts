// Apple Notes import (spec 9.2, 9.3): the Mac export file, the local route, and the iPhone Shortcut bridge.
import { parseNotes, stripHtml } from "./notes";
import { wordCount } from "./text";
import type { Page } from "./types";
import { newId } from "./util";
import { parseWordList, wordListText } from "./words";

export type AppleNote = { id: string; title: string; folder?: string; created?: string; modified?: string; html?: string; text?: string };
export type NotesExport = { openstudyNotes: 1; exportedAt: string; notes: AppleNote[] };

export const BRIDGE_MARKER = "=== OpenStudy note ===";
const PAGE_WORDS = 250;

export function isNotesExport(v: unknown): v is NotesExport {
  return !!v && typeof v === "object" && (v as { openstudyNotes?: unknown }).openstudyNotes === 1 && Array.isArray((v as NotesExport).notes);
}

/** FNV-1a 32 bit, lowercase hex (stable ids for Shortcut notes on both platforms). */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function hasBridgeMarker(text: string): boolean {
  return text.split(/\r?\n/).some((l) => l.trim() === BRIDGE_MARKER);
}

/** Text copied by the Shortcut: one chunk per note, optional Title:/Folder: lines (9.2). */
export function parseBridgeText(text: string): AppleNote[] {
  const chunks: string[][] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === BRIDGE_MARKER) chunks.push([]);
    else if (chunks.length) chunks[chunks.length - 1].push(line);
  }
  const out: AppleNote[] = [];
  for (const lines of chunks) {
    let title = "";
    let folder: string | undefined;
    while (lines.length && !lines[0].trim()) lines.shift();
    for (;;) {
      const m = /^(Title|Folder):\s?(.*)$/.exec(lines[0] ?? "");
      if (!m) break;
      if (m[1] === "Title") title = m[2].trim();
      else folder = m[2].trim() || undefined;
      lines.shift();
    }
    const body = lines.join("\n").trim();
    if (!body && !title) continue;
    out.push({ id: "sc:" + fnv1a(title + "\n" + body.slice(0, 200)), title, folder, text: body });
  }
  return out;
}

/** Note html to text with `#` headings, keeping paragraph breaks. */
export function noteHtmlToText(html: string): string {
  const marked = html.replace(/<\s*h([1-3])[^>]*>([\s\S]*?)<\s*\/\s*h\1\s*>/gi, (_m, n: string, inner: string) => `\n\n${"#".repeat(Number(n))} ${inner}\n\n`);
  return stripHtml(marked)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Section = { heading?: string; paras: string[] };

/** Sections at `#` headings; blank lines end a paragraph; bullets lose their markers. */
function sections(body: string): Section[] {
  const out: Section[] = [{ paras: [] }];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out[out.length - 1].paras.push(para.join("\n"));
    para = [];
  };
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const h = /^#{1,3}\s+(.+)$/.exec(line);
    if (h) {
      flush();
      out.push({ heading: h[1].trim(), paras: [] });
    } else if (!line) flush();
    else para.push(line.replace(/^(?:[-*•]|\d+[.)])\s+/, ""));
  }
  flush();
  return out.filter((s) => s.paras.length);
}

/** Pages of about 250 words, split at paragraph boundaries. */
function chunk(paras: string[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let n = 0;
  for (const p of paras) {
    const w = wordCount(p);
    if (cur.length && n + w > PAGE_WORDS) {
      out.push(cur.join("\n\n"));
      cur = [];
      n = 0;
    }
    cur.push(p);
    n += w;
  }
  if (cur.length) out.push(cur.join("\n\n"));
  return out;
}

/** One note to pages (9.3). Returns [] for notes to skip. */
export function notePages(note: AppleNote, now: Date = new Date()): Page[] {
  if ((note.folder ?? "").trim().toLowerCase() === "recently deleted") return [];
  let body = (note.text ?? (note.html ? noteHtmlToText(note.html) : "")).replace(/\r\n?/g, "\n").trim();
  const lines = body.split("\n");
  let title = note.title?.trim() ?? "";
  const first = lines.find((l) => l.trim())?.trim().replace(/^#{1,3}\s+/, "") ?? "";
  if (!title) title = first.slice(0, 80);
  if (first && first === title) body = lines.slice(lines.findIndex((l) => l.trim()) + 1).join("\n").trim();
  if (wordCount(body) < 8) return [];
  const createdAt = note.created && !Number.isNaN(Date.parse(note.created)) ? new Date(note.created).toISOString() : now.toISOString();
  const base = { projectId: null, kind: "note" as const, folder: note.folder?.trim() || undefined, noteId: note.id, createdAt };

  // A vocabulary note is one page with its entries (spec 10.2).
  if (!/Excerpt From/i.test(body)) {
    const wl = parseWordList(body, title);
    if (wl.isWordList)
      return [{ ...base, id: newId(), text: wordListText(body), words: wl.words, heading: "Words", sourceName: title || undefined, sourceIndex: 1 }];
  }

  if (/Excerpt From/i.test(body)) {
    return parseNotes(body).map((e, i) => ({
      ...base,
      id: newId(),
      text: e.text,
      suggestedTitle: e.suggestedTitle,
      suggestedAuthor: e.suggestedAuthor,
      verbatim: e.verbatim || undefined,
      sourceName: title || undefined,
      sourceIndex: i + 1,
    }));
  }

  const out: Page[] = [];
  for (const s of sections(body)) {
    chunk(s.paras).forEach((text, i) => {
      const heading = i === 0 ? (s.heading ?? title) : s.heading;
      out.push({ ...base, id: newId(), text, sourceName: title || undefined, sourceIndex: out.length + 1, ...(heading ? { heading } : {}) });
    });
  }
  return out;
}

export type NotesImport = { pages: Page[]; notes: number; already: number; empty: number };

/** Every note to pages, skipping notes already in the library (by noteId). */
export function importNotes(notes: AppleNote[], knownNoteIds: Set<string>, now: Date = new Date()): NotesImport {
  const pages: Page[] = [];
  let count = 0;
  let already = 0;
  let empty = 0;
  const seen = new Set(knownNoteIds);
  for (const n of notes) {
    if (!n.id) continue;
    if (seen.has(n.id)) {
      already++;
      continue;
    }
    seen.add(n.id);
    const ps = notePages(n, now);
    if (!ps.length) {
      if ((n.folder ?? "").toLowerCase() !== "recently deleted") empty++;
      continue;
    }
    pages.push(...ps);
    count++;
  }
  return { pages, notes: count, already, empty };
}

export function notesSummary(r: NotesImport): string {
  if (!r.pages.length && r.already) return `Nothing new. ${r.already === 1 ? "That note was" : `All ${r.already} notes were`} already here.`;
  const parts = [`Added ${r.pages.length} page${r.pages.length === 1 ? "" : "s"} from ${r.notes} note${r.notes === 1 ? "" : "s"}.`];
  if (r.already) parts.push(`${r.already} ${r.already === 1 ? "was" : "were"} already here.`);
  return parts.join(" ");
}

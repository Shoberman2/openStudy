// File format readers (spec 8.2). Pure: they take bytes or text and return page drafts.
import JSZip from "jszip";
import { parseNotes, stripHtml } from "./notes";
import type { PageKind } from "./types";
import { wordCount } from "./text";

export type PageDraft = {
  kind: PageKind;
  text: string;
  heading?: string;
  sourceIndex?: number;
  verbatim?: boolean;
  suggestedTitle?: string;
  suggestedAuthor?: string;
};
export type FileResult = { sourceTitle?: string; pages: PageDraft[] };

// ---------- XML helpers ----------

export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

function all(re: RegExp, s: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(s))) out.push(m);
  return out;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Paragraph texts of a DrawingML fragment: one string per <a:p>, runs joined. */
function drawingParagraphs(xml: string): string[] {
  return all(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/, xml)
    .map((m) => clean(all(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\s*\/>/, m[1]).map((t) => (t[1] !== undefined ? decodeXml(t[1]) : " ")).join("")))
    .filter(Boolean);
}

async function coreTitle(zip: JSZip): Promise<string | undefined> {
  const core = await zip.file("docProps/core.xml")?.async("string");
  const m = core?.match(/<dc:title>([\s\S]*?)<\/dc:title>/);
  const t = m ? clean(decodeXml(m[1])) : "";
  return t || undefined;
}

const num = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);

// ---------- PPTX ----------

export type Slide = { index: number; heading?: string; body: string[]; notes: string[] };

export async function parsePptxSlides(data: ArrayBuffer | Uint8Array): Promise<{ title?: string; slides: Slide[] }> {
  const zip = await JSZip.loadAsync(data);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => num(a) - num(b));
  const slides: Slide[] = [];
  for (const [i, name] of names.entries()) {
    const xml = await zip.file(name)!.async("string");
    let heading: string | undefined;
    const body: string[] = [];
    for (const sp of all(/<p:sp>([\s\S]*?)<\/p:sp>|<p:graphicFrame>([\s\S]*?)<\/p:graphicFrame>/, xml)) {
      const frag = sp[1] ?? sp[2] ?? "";
      const type = frag.match(/<p:ph\b[^>]*>/)?.[0].match(/type="([^"]+)"/)?.[1];
      const paras = drawingParagraphs(frag);
      if (type === "sldNum" || type === "dt" || type === "ftr") continue;
      if ((type === "title" || type === "ctrTitle") && !heading) heading = paras.join(" ") || undefined;
      else body.push(...paras);
    }
    // Speaker notes via the slide's relationship file.
    const notes: string[] = [];
    const rels = await zip.file(name.replace("slides/", "slides/_rels/") + ".rels")?.async("string");
    const target = rels?.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)?.[1];
    const notesXml = target ? await zip.file(`ppt/notesSlides/${target}`)?.async("string") : undefined;
    if (notesXml) {
      for (const sp of all(/<p:sp>([\s\S]*?)<\/p:sp>/, notesXml)) {
        const type = sp[1].match(/<p:ph\b[^>]*?type="([^"]+)"/)?.[1];
        if (type === "sldNum" || type === "sldImg" || type === "hdr" || type === "ftr" || type === "dt") continue;
        notes.push(...drawingParagraphs(sp[1]));
      }
    }
    slides.push({ index: i + 1, heading, body, notes });
  }
  return { title: await coreTitle(zip), slides };
}

export async function readPptx(data: ArrayBuffer | Uint8Array): Promise<FileResult> {
  const { title, slides } = await parsePptxSlides(data);
  const pages: PageDraft[] = [];
  for (const s of slides) {
    const lines = [...s.body, ...s.notes];
    const text = lines.join("\n");
    if (wordCount([s.heading ?? "", text].join(" ")) < 3 || !text.trim()) continue;
    pages.push({ kind: "slides", heading: s.heading, text, sourceIndex: s.index });
  }
  return { sourceTitle: title, pages };
}

// ---------- DOCX ----------

export type DocPara = { text: string; heading: boolean };

export async function parseDocxParagraphs(data: ArrayBuffer | Uint8Array): Promise<{ title?: string; paras: DocPara[] }> {
  const zip = await JSZip.loadAsync(data);
  const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const paras: DocPara[] = [];
  for (const m of all(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/, xml)) {
    const style = m[1].match(/<w:pStyle\s+w:val="([^"]+)"/)?.[1] ?? "";
    const text = clean(
      all(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br)\s*\/>/, m[1])
        .map((t) => (t[1] !== undefined ? decodeXml(t[1]) : " "))
        .join(""),
    );
    if (!text) continue;
    paras.push({ text, heading: /^(heading\s?[123]|title)$/i.test(style) });
  }
  return { title: await coreTitle(zip), paras };
}

/** Split paragraphs into sections at headings, or every ~250 words when there are none. */
export function sectionize(paras: DocPara[], chunkWords = 250): { heading?: string; text: string }[] {
  const out: { heading?: string; lines: string[] }[] = [];
  const hasHeadings = paras.some((p) => p.heading);
  let cur: { heading?: string; lines: string[] } = { lines: [] };
  let words = 0;
  for (const p of paras) {
    if (p.heading) {
      if (cur.lines.length || cur.heading) out.push(cur);
      cur = { heading: p.text, lines: [] };
      words = 0;
      continue;
    }
    if (!hasHeadings && words >= chunkWords) {
      out.push(cur);
      cur = { lines: [] };
      words = 0;
    }
    cur.lines.push(p.text);
    words += wordCount(p.text);
  }
  if (cur.lines.length || cur.heading) out.push(cur);
  return out.filter((s) => s.lines.length).map((s) => ({ heading: s.heading, text: s.lines.join("\n") }));
}

export async function readDocx(data: ArrayBuffer | Uint8Array): Promise<FileResult> {
  const { title, paras } = await parseDocxParagraphs(data);
  return { sourceTitle: title, pages: sectionize(paras).map((s, i) => ({ kind: "doc", heading: s.heading, text: s.text, sourceIndex: i + 1 })) };
}

// ---------- TXT / MD / HTML ----------

export function readTextFile(name: string, content: string): FileResult {
  const isHtml = /\.html?$/i.test(name) || /^\s*<(!doctype|html|body|div|p|h1)/i.test(content);
  let text = content.replace(/\r\n?/g, "\n");
  if (isHtml) {
    text = text.replace(/<\s*h([1-3])[^>]*>([\s\S]*?)<\s*\/\s*h\1\s*>/gi, (_m, _l, inner: string) => `\n\n# ${stripHtml(inner).trim()}\n\n`);
    text = stripHtml(text);
  }
  // Apple Books excerpts keep their exact-quote behavior (spec 3.2).
  if (/Excerpt From/i.test(text) && /protected by copyright/i.test(text)) {
    return {
      pages: parseNotes(text).map((e, i) => ({ kind: "note", text: e.text, suggestedTitle: e.suggestedTitle, suggestedAuthor: e.suggestedAuthor, verbatim: e.verbatim, sourceIndex: i + 1 })),
    };
  }
  const paras: DocPara[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    for (const raw of block.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const h = line.match(/^#{1,3}\s+(.+)$/);
      if (h) paras.push({ text: h[1].replace(/#+$/, "").trim(), heading: true });
      else paras.push({ text: line.replace(/^(?:[-*•]|\d+[.)])\s+/, ""), heading: false });
    }
  }
  return { pages: sectionize(paras).map((s, i) => ({ kind: "doc", heading: s.heading, text: s.text, sourceIndex: i + 1 })) };
}

/** "Lecture_04 - Enzymes.pptx" -> "Enzymes"; "bio101-week3-notes.pdf" -> "Bio101". */
export function cleanFileTitle(name: string): string {
  let t = name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ");
  t = t.replace(/\b(lecture|lec|week|wk|slides?|notes?|chapter|ch|unit|session|class|part)\s*[-#.]?\s*\d+[a-z]?\b/gi, " ");
  t = t.replace(/\b(lecture|lec|slides?|notes?|handout|final|draft|v\d+)\b/gi, " ");
  t = t.replace(/^[\s\-:.,]+|[\s\-:.,]+$/g, "").replace(/\s*[-:]\s*[-:]\s*/g, " - ").replace(/\s+/g, " ").trim();
  t = t.replace(/^[-:]\s*/, "").replace(/\s*[-:]$/, "").replace(/\s+:\s*/g, ": ").replace(/^[:\s]+/, "");
  if (!t) t = name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export type FileKind = "image" | "pdf" | "pptx" | "docx" | "text" | "unknown";

export function fileKind(name: string, mime = ""): FileKind {
  const n = name.toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|heic|heif|webp|gif|bmp|tiff?)$/.test(n)) return "image";
  if (mime === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".pptx")) return "pptx";
  if (n.endsWith(".docx")) return "docx";
  if (/\.(txt|md|markdown|html?|text)$/.test(n) || mime.startsWith("text/")) return "text";
  return "unknown";
}

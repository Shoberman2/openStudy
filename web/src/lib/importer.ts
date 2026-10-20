"use client";

// One importer for every format (spec 8.2). Each file becomes one or more inbox pages that stay together.
import { fileKind, readDocx, readPptx, readTextFile, type FileKind, type PageDraft } from "@/engine/formats";
import { cleanOcr, type OcrLine } from "@/engine/ocr-clean";
import { wordCount } from "@/engine/text";
import type { Page } from "@/engine/types";
import { newId } from "@/engine/util";
import { readImageSmart } from "./ai";
import { imageHash, makeThumbnail, saveImage } from "./images";
import { parseWordList, wordListText } from "@/engine/words";
import { OcrPool, toCanvas } from "./ocr";

export type FileStatus = {
  id: string;
  name: string;
  kind: FileKind;
  status: "queued" | "reading" | "done" | "empty" | "skipped" | "error";
  progress: number;
  pages: number;
  note?: string;
  previewUrl?: string;
};

type Callbacks = {
  onStatus: (s: FileStatus) => void;
  onPages: (pages: Page[]) => void;
  onWorker?: (s: string) => void;
};

/** Phone-shaped portrait screenshots get the Apple Books header/footer rules (spec 3.1). */
const isPhoneScreenshot = (w: number, h: number) => h / w >= 1.85;

function photoText(lines: OcrLine[]): { text: string; heading?: string } {
  // Keep line structure (bullets on a whiteboard); a big vertical gap starts a new paragraph.
  const sorted = lines.filter((l) => l.text.trim().length >= 2).sort((a, b) => a.top - b.top);
  const out: string[] = [];
  let prevBottom = -Infinity;
  let lineH = 0;
  for (const l of sorted) {
    const h = l.bottom - l.top;
    lineH = lineH ? (lineH + h) / 2 : h;
    if (out.length && l.top - prevBottom > lineH * 1.2) out.push("");
    out.push(l.text.trim());
    prevBottom = l.bottom;
  }
  const first = out.find(Boolean);
  const heading = first && first.length < 60 && !/[.]$/.test(first) && wordCount(first) <= 8 ? first : undefined;
  const body = heading ? out.slice(out.indexOf(first!) + 1) : out;
  return { text: body.join("\n").replace(/\n{3,}/g, "\n\n").trim(), heading };
}

export class Importer {
  private pool: OcrPool;
  private queue: { file: File; status: FileStatus }[] = [];
  private running = 0;

  constructor(private cb: Callbacks, private concurrency = 2) {
    this.pool = new OcrPool(2, cb.onWorker);
  }

  add(files: File[]): FileStatus[] {
    const added = files.map((file) => {
      const kind = fileKind(file.name, file.type);
      const status: FileStatus = {
        id: newId(),
        name: file.name,
        kind,
        status: "queued",
        progress: 0,
        pages: 0,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
      };
      this.queue.push({ file, status });
      this.cb.onStatus({ ...status });
      return status;
    });
    this.pump();
    return added;
  }

  private pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void this.run(job.file, job.status).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private update(s: FileStatus, patch: Partial<FileStatus>) {
    Object.assign(s, patch);
    this.cb.onStatus({ ...s });
  }

  private emit(file: File, drafts: (PageDraft & { image?: Blob })[], sourceTitle?: string): number {
    const now = new Date().toISOString();
    const photoTime = new Date(file.lastModified || Date.now()).toISOString();
    const pages: Page[] = drafts.map((d) => {
      const id = newId();
      let image: string | undefined;
      if (d.image) {
        image = `img:${id}`;
        void saveImage(image, d.image);
      }
      return {
        id,
        projectId: null,
        kind: d.kind,
        text: d.text,
        heading: d.heading,
        header: d.kind === "screenshot" ? d.heading : undefined,
        sourceName: d.kind === "screenshot" ? undefined : file.name,
        sourceIndex: d.sourceIndex,
        sourceTitle,
        verbatim: d.verbatim,
        suggestedTitle: d.suggestedTitle,
        suggestedAuthor: d.suggestedAuthor,
        words: d.words,
        pageNumber: d.pageNumber,
        imageHash: d.imageHash,
        image,
        createdAt: d.kind === "photo" ? photoTime : now,
      };
    });
    if (pages.length) this.cb.onPages(pages);
    return pages.length;
  }

  private async run(file: File, s: FileStatus) {
    this.update(s, { status: "reading" });
    try {
      switch (s.kind) {
        case "image":
          return await this.readImage(file, s);
        case "pdf":
          return await this.readPdfFile(file, s);
        case "pptx": {
          const r = await readPptx(await file.arrayBuffer());
          return this.finish(s, this.emit(file, r.pages, r.sourceTitle));
        }
        case "docx": {
          const r = await readDocx(await file.arrayBuffer());
          return this.finish(s, this.emit(file, r.pages, r.sourceTitle));
        }
        case "text": {
          const r = readTextFile(file.name, await file.text());
          return this.finish(s, this.emit(file, r.pages));
        }
        default:
          this.update(s, { status: "error", progress: 1, note: "Not a supported file" });
      }
    } catch (e) {
      this.update(s, { status: "error", progress: 1, note: e instanceof Error && e.message.length < 60 ? e.message : "Could not read this file" });
    }
  }

  private finish(s: FileStatus, n: number) {
    this.update(s, n ? { status: "done", progress: 1, pages: n } : { status: "empty", progress: 1, pages: 0, note: "No readable text" });
  }

  private async readImage(file: File, s: FileStatus) {
    const canvas = await toCanvas(file);
    const bitmap = await createImageBitmap(canvas);
    const thumb = await makeThumbnail(bitmap);
    bitmap.close();
    const phone = isPhoneScreenshot(canvas.width, canvas.height);
    const hash = imageHash(canvas);
    const kind = phone ? "screenshot" : "photo";
    // A photo of a vocabulary list is one word-list page (spec 10.2).
    const wordPage = (text: string) => {
      const wl = parseWordList(text, file.name);
      return wl.isWordList ? { kind, text: wordListText(text), words: wl.words, heading: "Words", sourceIndex: 1, image: thumb, imageHash: hash } as const : null;
    };

    // Smart organize reads handwriting and diagrams far better; local OCR is the fallback.
    const smart = await readImageSmart(canvas).catch(() => null);
    if (smart && wordCount(smart.text) >= 5) {
      const wp = wordPage([smart.heading ?? "", smart.text].join("\n"));
      return this.finish(s, this.emit(file, [wp ?? { kind, text: smart.text, heading: smart.heading, sourceIndex: 1, image: thumb, imageHash: hash }]));
    }

    const out = await this.pool.recognize(canvas, (p) => this.update(s, { progress: p }));
    if (phone) {
      const cleaned = cleanOcr(out.lines, out.height);
      const wp = wordPage(cleaned.lines.join("\n"));
      if (wp) return this.finish(s, this.emit(file, [wp]));
      if (!cleaned.skipped)
        return this.finish(s, this.emit(file, [{ kind: "screenshot", text: cleaned.text, heading: cleaned.header, sourceIndex: 1, image: thumb, imageHash: hash, pageNumber: cleaned.pageNumber }]));
      return this.update(s, { status: "skipped", progress: 1, note: "Not a book page" });
    }
    const p = photoText(out.lines);
    const wp = wordPage([p.heading ?? "", p.text].join("\n"));
    if (wp) return this.finish(s, this.emit(file, [wp]));
    if (wordCount([p.heading ?? "", p.text].join(" ")) < 5) return this.update(s, { status: "empty", progress: 1, note: "No readable text" });
    return this.finish(s, this.emit(file, [{ kind: "photo", text: p.text || p.heading || "", heading: p.text ? p.heading : undefined, sourceIndex: 1, image: thumb, imageHash: hash }]));
  }

  private async readPdfFile(file: File, s: FileStatus) {
    const { readPdf } = await import("./pdf");
    const { title, pages } = await readPdf(await file.arrayBuffer(), (i, n) => this.update(s, { progress: (i - 1) / n, note: `Page ${i} of ${n}` }));
    const drafts: (PageDraft & { image?: Blob })[] = [];
    let scanned = 0;
    for (const pg of pages) {
      if (pg.scan) {
        scanned++;
        this.update(s, { note: `Reading scanned page ${pg.index}` });
        const smart = await readImageSmart(pg.scan).catch(() => null);
        let text: string;
        let heading: string | undefined;
        if (smart) ({ text, heading } = smart);
        else {
          const out = await this.pool.recognize(pg.scan);
          ({ text, heading } = photoText(out.lines));
        }
        const bitmap = await createImageBitmap(pg.scan);
        const thumb = await makeThumbnail(bitmap);
        bitmap.close();
        if (wordCount([heading ?? "", text].join(" ")) >= 5) drafts.push({ kind: "pdf", text, heading, sourceIndex: pg.index, image: thumb });
      } else if (wordCount(pg.text) >= 3) drafts.push({ kind: "pdf", text: pg.text, heading: pg.heading, sourceIndex: pg.index });
    }
    const n = this.emit(file, drafts, title);
    this.update(s, n ? { status: "done", progress: 1, pages: n, note: scanned ? `${scanned} scanned page${scanned === 1 ? "" : "s"} read` : undefined } : { status: "empty", progress: 1, note: "No readable text" });
  }

  async dispose() {
    await this.pool.dispose();
  }
}

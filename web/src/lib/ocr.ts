"use client";

// Local OCR pool (spec 3.1 / 8.2). tesseract.js loads lazily, only when something needs reading.
import type { OcrLine } from "@/engine/ocr-clean";

type TWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
type TBlock = { paragraphs: { lines: { text: string; bbox: { y0: number; y1: number } }[] }[] };

export type OcrOutput = { lines: OcrLine[]; height: number; width: number };
type Job = { canvas: HTMLCanvasElement; onProgress?: (p: number) => void; resolve: (o: OcrOutput) => void; reject: (e: unknown) => void };

const MAX_OCR_WIDTH = 1600;

export async function toCanvas(src: Blob | HTMLCanvasElement, maxWidth = MAX_OCR_WIDTH): Promise<HTMLCanvasElement> {
  if (src instanceof HTMLCanvasElement) return src;
  const bitmap = await createImageBitmap(src);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

function linesFrom(blocks: TBlock[] | null): OcrLine[] {
  const out: OcrLine[] = [];
  for (const b of blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) out.push({ text: l.text.replace(/\n/g, " ").trim(), top: l.bbox.y0, bottom: l.bbox.y1 });
  return out;
}

export class OcrPool {
  private workers: TWorker[] = [];
  private busy: boolean[] = [];
  private current: (Job | null)[] = [];
  private starting: Promise<void> | null = null;
  private queue: Job[] = [];

  constructor(private concurrency = 2, private onStatus?: (s: string) => void) {}

  private start() {
    if (!this.starting)
      this.starting = (async () => {
        this.onStatus?.("Loading the text reader");
        const { createWorker } = await import("tesseract.js");
        this.workers = await Promise.all(
          Array.from({ length: this.concurrency }, (_, wi) =>
            createWorker("eng", 1, {
              logger: (m) => {
                if (m.status === "recognizing text") this.current[wi]?.onProgress?.(m.progress);
              },
            }),
          ),
        );
        this.busy = this.workers.map(() => false);
        this.current = this.workers.map(() => null);
        this.onStatus?.("");
      })();
    return this.starting;
  }

  recognize(canvas: HTMLCanvasElement, onProgress?: (p: number) => void): Promise<OcrOutput> {
    return new Promise((resolve, reject) => {
      this.queue.push({ canvas, onProgress, resolve, reject });
      void this.pump();
    });
  }

  private async pump() {
    await this.start();
    for (let wi = 0; wi < this.workers.length; wi++) {
      if (this.busy[wi] || !this.queue.length) continue;
      const job = this.queue.shift()!;
      this.busy[wi] = true;
      this.current[wi] = job;
      this.workers[wi]
        .recognize(job.canvas, {}, { blocks: true, text: true })
        .then(({ data }) => job.resolve({ lines: linesFrom(data.blocks as unknown as TBlock[]), height: job.canvas.height, width: job.canvas.width }))
        .catch(job.reject)
        .finally(() => {
          this.busy[wi] = false;
          this.current[wi] = null;
          void this.pump();
        });
    }
  }

  async dispose() {
    const ws = this.workers;
    this.workers = [];
    this.starting = null;
    await Promise.all(ws.map((w) => w.terminate().catch(() => undefined)));
  }
}

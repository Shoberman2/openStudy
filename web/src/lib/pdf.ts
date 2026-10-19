"use client";

// PDF reading with pdf.js (spec 8.2). Typed pages use the text layer; pages with < 20 characters are
// rendered at 2x and handed back for OCR (scanned PDFs).
export type PdfPage = { index: number; text: string; heading?: string; scan?: HTMLCanvasElement };

type TextItem = { str: string; transform: number[]; height: number; hasEOL?: boolean };

export async function readPdf(data: ArrayBuffer, onPage?: (i: number, n: number) => void): Promise<{ title?: string; pages: PdfPage[] }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  let title: string | undefined;
  try {
    const meta = await doc.getMetadata();
    const t = (meta.info as { Title?: string } | undefined)?.Title?.trim();
    // Skip generator junk like "about:blank", URLs, file names and "Microsoft Word - x.docx".
    if (t && !/^(untitled|microsoft|powerpoint|slide|about:|https?:|file:)/i.test(t) && !/\.(pdf|docx?|pptx?|html?)$/i.test(t)) title = t;
  } catch {
    /* no metadata */
  }
  const pages: PdfPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onPage?.(i, doc.numPages);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Group text items into lines by baseline.
    const rows: { y: number; size: number; parts: { x: number; s: string }[] }[] = [];
    for (const raw of content.items as TextItem[]) {
      if (!("str" in raw) || !raw.str.trim()) continue;
      const y = Math.round(raw.transform[5]);
      const size = Math.round(Math.hypot(raw.transform[2], raw.transform[3]) || raw.height || 0);
      const row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, size * 0.3));
      if (row) {
        row.parts.push({ x: raw.transform[4], s: raw.str });
        row.size = Math.max(row.size, size);
      } else rows.push({ y, size, parts: [{ x: raw.transform[4], s: raw.str }] });
    }
    rows.sort((a, b) => b.y - a.y);
    const lines = rows
      .map((r) => ({ size: r.size, text: r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim() }))
      .filter((l) => l.text);
    const text = lines.map((l) => l.text).join("\n");
    if (text.replace(/\s/g, "").length < 20) {
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      pages.push({ index: i, text: "", scan: canvas });
      continue;
    }
    // Heading: the largest-font line when it stands out, else the first short line.
    const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
    const big = lines.filter((l) => l.size >= median * 1.25 && l.text.length < 80).sort((a, b) => b.size - a.size)[0];
    const short = lines.find((l) => l.text.length < 80 && !/[.]$/.test(l.text));
    const heading = (big ?? short)?.text;
    const body = heading ? lines.filter((l) => l.text !== heading).map((l) => l.text).join("\n") : text;
    pages.push({ index: i, text: body || text, heading });
  }
  await task.destroy();
  return { title, pages };
}

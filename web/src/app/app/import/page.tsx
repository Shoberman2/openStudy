"use client";

import { CircleAlert, CircleCheck, FileText, Image as ImageIcon, LoaderCircle, Presentation, Upload } from "lucide-react";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { inboxPages, logEvent } from "@/engine/library";
import { parseNotes, stripHtml } from "@/engine/notes";
import { normalizeForDedupe } from "@/engine/text";
import type { Library, Page as LibPage } from "@/engine/types";
import { newId } from "@/engine/util";
import type { FileKind } from "@/engine/formats";
import type { FileStatus, Importer } from "@/lib/importer";
import { useLibrary } from "@/lib/store";
import { BackHeader, Loading, Page } from "@/components/app/AppChrome";
import { ProgressBar } from "@/components/ui/basics";

type Mode = "files" | "notes";

function addPages(lib: Library, pages: LibPage[]): { lib: Library; added: number } {
  const seen = new Set(lib.pages.map((p) => normalizeForDedupe(p.text)));
  const fresh = pages.filter((p) => {
    const k = normalizeForDedupe(p.text);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { lib: { ...lib, pages: [...lib.pages, ...fresh] }, added: fresh.length };
}

export default function ImportPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ImportInner />
    </Suspense>
  );
}

function ImportInner() {
  const { lib, ready, update } = useLibrary();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "notes" ? "notes" : "files");

  if (!ready) return <Loading />;
  const inbox = inboxPages(lib).length;

  return (
    <>
      <BackHeader href="/app" title="Import pages" />
      <Page>
        <div className="grid grid-cols-2 gap-2 rounded-[16px] bg-shelf p-1.5" role="tablist">
          {(["files", "notes"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`h-11 rounded-[12px] font-extrabold transition-colors ${mode === m ? "bg-paper text-ink shadow-[0_2px_0_var(--line)]" : "text-muted"}`}
            >
              {m === "files" ? "Files and photos" : "Paste text"}
            </button>
          ))}
        </div>
        <div className="mt-6">{mode === "files" ? <Files update={update} /> : <Notes update={update} />}</div>
        {inbox > 0 && (
          <div className="mt-8 flex items-center justify-between gap-3 rounded-[16px] border-2 border-line p-4">
            <p className="font-bold">
              {inbox} page{inbox === 1 ? "" : "s"} ready to sort
            </p>
            <Link href="/app/sort" className="btn btn-sm">
              Sort pages
            </Link>
          </div>
        )}
      </Page>
    </>
  );
}

const KIND_ICON: Record<FileKind, typeof FileText> = { image: ImageIcon, pdf: FileText, pptx: Presentation, docx: FileText, text: FileText, unknown: FileText };

function Files({ update }: { update: (fn: (l: Library) => Library) => void }) {
  const [items, setItems] = useState<Record<string, FileStatus>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [worker, setWorker] = useState("");
  const [dragging, setDragging] = useState(false);
  const importer = useRef<Importer | null>(null);
  const logged = useRef(new Set<string>());
  const batch = useRef({ files: 0, pages: 0, empty: 0, skipped: 0, finished: 0 });

  const onStatus = useCallback(
    (st: FileStatus) => {
      setItems((prev) => ({ ...prev, [st.id]: st }));
      const final = st.status === "done" || st.status === "empty" || st.status === "skipped" || st.status === "error";
      if (!final || logged.current.has(st.id)) return;
      logged.current.add(st.id);
      const b = batch.current;
      b.finished++;
      if (st.status === "empty" || st.status === "error") b.empty++;
      if (st.status === "skipped") b.skipped++;
      if (b.finished === b.files) {
        update((l) => logEvent(l, "import", { kind: "files", count: b.pages, skipped: b.empty + b.skipped, files: b.files }));
      }
    },
    [update],
  );
  const onPages = useCallback(
    (pages: LibPage[]) =>
      update((l) => {
        const r = addPages(l, pages);
        batch.current.pages += r.added;
        return r.lib;
      }),
    [update],
  );

  useEffect(() => () => void importer.current?.dispose(), []);

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    if (!importer.current) {
      const { Importer } = await import("@/lib/importer");
      importer.current = new Importer({ onStatus, onPages, onWorker: setWorker });
    }
    if (batch.current.finished === batch.current.files) batch.current = { files: 0, pages: 0, empty: 0, skipped: 0, finished: 0 };
    batch.current.files += files.length;
    const added = importer.current.add(files);
    setOrder((o) => [...o, ...added.map((a) => a.id)]);
  };

  const list = order.map((id) => items[id]).filter(Boolean);
  const finished = list.filter((i) => ["done", "empty", "skipped", "error"].includes(i.status)).length;
  const pages = list.reduce((s, i) => s + i.pages, 0);
  const empty = list.filter((i) => i.status === "empty" || i.status === "error").length;
  const skipped = list.filter((i) => i.status === "skipped").length;
  const overall = list.length ? list.reduce((s, i) => s + (i.status === "queued" ? 0 : i.progress), 0) / list.length : 0;
  const summary = [
    `Added ${pages} page${pages === 1 ? "" : "s"} from ${list.length} file${list.length === 1 ? "" : "s"}.`,
    empty ? `${empty} had no readable text.` : "",
    skipped ? `${skipped} skipped (not book pages).` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles([...e.dataTransfer.files]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-[20px] border-2 border-dashed px-5 py-10 text-center transition-colors ${dragging ? "border-blue bg-blue-soft" : "border-[var(--line-strong)] bg-shelf"}`}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-paper text-blue" style={{ boxShadow: "0 3px 0 var(--line)" }}>
          <Upload size={28} strokeWidth={2.5} />
        </span>
        <span className="mt-4 max-w-[420px] text-[20px] font-black leading-tight">Drop anything: screenshots, photos of notes or a whiteboard, PDFs, slides, docs.</span>
        <span className="mt-2 max-w-[380px] text-[15px] text-muted">Text is read on this device. Keynote or Google Slides? Export to .pptx or .pdf first.</span>
        <span className="btn btn-sm mt-5">
          <Upload size={18} strokeWidth={2.5} /> Choose files
        </span>
        <input
          type="file"
          multiple
          accept="image/*,.pdf,application/pdf,.pptx,.docx,.txt,.md,.markdown,.html,.htm,text/plain,text/markdown,text/html"
          className="sr-only"
          data-testid="file-input"
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </label>

      {list.length > 0 && (
        <section className="mt-6" aria-live="polite">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-extrabold">{finished < list.length ? `Reading ${Math.min(finished + 1, list.length)} of ${list.length}` : "Done reading"}</p>
            <p className="text-[14px] font-bold text-muted">{worker || (finished === list.length ? summary : `${pages} pages so far`)}</p>
          </div>
          <ProgressBar value={finished === list.length ? 1 : overall} label="Import progress" />
          {finished === list.length && <p className="sr-only" data-testid="import-summary">{summary}</p>}
          <ul className="mt-4 grid grid-cols-1 gap-2.5">
            {list.map((it) => {
              const Icon = KIND_ICON[it.kind];
              return (
                <li key={it.id} className="flex items-center gap-3 rounded-[14px] border-2 border-line p-2.5" data-testid="import-item">
                  {it.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.previewUrl} alt="" className={`h-12 w-12 flex-none rounded-[10px] border-2 border-line object-cover ${it.status === "skipped" || it.status === "empty" ? "opacity-40" : ""}`} />
                  ) : (
                    <span className="flex h-12 w-12 flex-none items-center justify-center rounded-[10px] bg-shelf text-ink">
                      <Icon size={22} strokeWidth={2.25} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{it.name}</p>
                    <p className="truncate text-[13px] font-semibold text-muted">
                      {it.status === "done"
                        ? `${it.pages} page${it.pages === 1 ? "" : "s"}${it.note ? `, ${it.note}` : ""}`
                        : it.status === "reading"
                          ? it.note ?? (it.kind === "image" ? `Reading ${Math.round(it.progress * 100)}%` : "Reading")
                          : it.status === "queued"
                            ? "Waiting"
                            : it.note}
                    </p>
                  </div>
                  <span className="flex-none">
                    {it.status === "done" && <CircleCheck size={20} strokeWidth={2.75} className="text-green" />}
                    {(it.status === "empty" || it.status === "skipped") && <CircleAlert size={20} strokeWidth={2.75} className="text-muted" />}
                    {it.status === "error" && <CircleAlert size={20} strokeWidth={2.75} className="text-red" />}
                    {(it.status === "reading" || it.status === "queued") && <LoaderCircle size={20} strokeWidth={2.75} className={`text-blue ${it.status === "reading" ? "animate-spin" : "opacity-40"}`} />}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Notes({ update }: { update: (fn: (l: Library) => Library) => void }) {
  const [text, setText] = useState("");
  const [added, setAdded] = useState<{ count: number; books: number } | null>(null);
  const parsed = useMemo(() => (text.trim() ? parseNotes(text) : []), [text]);
  const books = new Set(parsed.map((p) => p.suggestedTitle ?? "")).size;

  const add = () => {
    const now = new Date().toISOString();
    const pages: LibPage[] = parsed.map((p) => ({
      id: newId(),
      projectId: null,
      kind: "note",
      text: p.text,
      suggestedTitle: p.suggestedTitle,
      suggestedAuthor: p.suggestedAuthor,
      verbatim: p.verbatim || undefined,
      createdAt: now,
    }));
    let count = 0;
    update((l) => {
      const r = addPages(l, pages);
      count = r.added;
      return logEvent(r.lib, "import", { kind: "note", count: r.added, skipped: pages.length - r.added });
    });
    setAdded({ count, books });
    setText("");
  };

  const onFiles = async (files: FileList | null) => {
    const parts: string[] = [];
    for (const f of [...(files ?? [])]) {
      const raw = await f.text();
      parts.push(/\.html?$/i.test(f.name) || f.type === "text/html" ? stripHtml(raw) : raw);
    }
    if (parts.length) setText((t) => [t, ...parts].filter(Boolean).join("\n\n"));
  };

  return (
    <div>
      <p className="text-muted">
        Paste class notes or excerpts. From Apple Books, the <span className="font-bold text-ink">Excerpt From</span> line tells us the book.
      </p>
      <textarea
        className="input serif mt-4 min-h-[260px] !font-normal !text-[17px] leading-relaxed"
        placeholder={"“The only way to get the best of an argument is to avoid it.”\n\nExcerpt From\nHow to Win Friends and Influence People\nDale Carnegie\nThis material may be protected by copyright."}
        value={text}
        aria-label="Pasted notes"
        onChange={(e) => {
          setText(e.target.value);
          setAdded(null);
        }}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-[15px] font-bold text-blue hover:underline">
          <FileText size={18} strokeWidth={2.5} /> Open .txt, .md or .html
          <input type="file" accept=".txt,.md,.markdown,.html,.htm,text/plain,text/markdown,text/html" multiple className="sr-only" onChange={(e) => void onFiles(e.target.files)} />
        </label>
        <p className="text-[14px] font-bold text-muted">
          {parsed.length ? `${parsed.length} excerpt${parsed.length === 1 ? "" : "s"}${books > 1 || parsed[0]?.suggestedTitle ? ` from ${books} book${books === 1 ? "" : "s"}` : ""}` : ""}
        </p>
      </div>
      <button className="btn btn-block mt-5" disabled={!parsed.length} onClick={add}>
        Add {parsed.length || ""} excerpt{parsed.length === 1 ? "" : "s"}
      </button>
      {added && (
        <p className="anim-fade mt-4 flex items-center gap-2 font-bold text-green">
          <CircleCheck size={20} strokeWidth={2.75} /> Added {added.count} page{added.count === 1 ? "" : "s"}.
        </p>
      )}
    </div>
  );
}

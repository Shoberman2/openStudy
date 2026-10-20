"use client";

import { CircleAlert, CircleCheck, FileText, Image as ImageIcon, LoaderCircle, NotebookText, Presentation, Upload } from "lucide-react";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { hasBridgeMarker, importNotes, isNotesExport, notesSummary, parseBridgeText, type AppleNote } from "@/engine/applenotes";
import { inboxPages, logEvent } from "@/engine/library";
import { parseNotes, stripHtml } from "@/engine/notes";
import { dropDuplicates } from "@/engine/dedupe";
import { parseWordList, wordListText } from "@/engine/words";
import type { Library, Page as LibPage } from "@/engine/types";
import { newId } from "@/engine/util";
import type { FileKind } from "@/engine/formats";
import type { FileStatus, Importer } from "@/lib/importer";
import { fetchLocalNotes, localNotesOn } from "@/lib/ai";
import { useLibrary } from "@/lib/store";
import { BackHeader, Loading, Page } from "@/components/app/AppChrome";
import { ProgressBar } from "@/components/ui/basics";

type Mode = "files" | "notes";

/** Adds pages, dropping duplicates of the library and of each other (spec 10.3). */
function addPages(lib: Library, pages: LibPage[]): { lib: Library; added: number; duplicates: number } {
  const { fresh, duplicates } = dropDuplicates(lib.pages, pages.filter((p) => p.text.trim()));
  return { lib: { ...lib, pages: [...lib.pages, ...fresh] }, added: fresh.length, duplicates };
}

const dupLine = (n: number) => (n ? ` ${n} ${n === 1 ? "was a duplicate" : "were duplicates"}.` : "");

/** Apple Notes (export file, local route or Shortcut text) into the inbox (spec 9.3). */
function addNotes(lib: Library, notes: AppleNote[], source: string): { lib: Library; summary: string } {
  const known = new Set(lib.pages.map((p) => p.noteId).filter((x): x is string => !!x));
  const r = importNotes(notes, known);
  const added = addPages(lib, r.pages);
  let next = logEvent(added.lib, "import", { kind: "note", count: added.added, skipped: r.empty + r.already, duplicates: added.duplicates });
  next = logEvent(next, "library_scan", { source, checked: notes.length, found: r.notes });
  return { lib: next, summary: notesSummary({ ...r, pages: r.pages.slice(0, added.added) }) + dupLine(added.duplicates) };
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
        <AppleNotes update={update} />
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

/** "Bring in Apple Notes": only when the web app runs locally on a Mac with `npm run dev:notes`. */
function AppleNotes({ update }: { update: (fn: (l: Library) => Library) => void }) {
  const [on, setOn] = useState(false);
  const [state, setState] = useState<"idle" | "reading" | "permission" | "failed">("idle");
  const [summary, setSummary] = useState("");
  useEffect(() => {
    void localNotesOn().then(setOn);
  }, []);
  if (!on) return null;

  const run = async () => {
    setState("reading");
    setSummary("");
    const res = await fetchLocalNotes();
    if (typeof res === "string") return setState(res);
    let text = "";
    update((l) => {
      const r = addNotes(l, res.notes, "notes");
      text = r.summary;
      return r.lib;
    });
    setSummary(text);
    setState("idle");
  };

  return (
    <section className="mb-6 flex flex-wrap items-center gap-4 rounded-[16px] border-2 border-line p-4" data-testid="apple-notes">
      <span className="flex h-12 w-12 flex-none items-center justify-center rounded-[14px] bg-shelf text-blue">
        <NotebookText size={24} strokeWidth={2.5} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-extrabold">Apple Notes on this Mac</p>
        <p className="text-[14px] font-semibold text-muted">
          {state === "reading"
            ? "Reading your notes. macOS may ask to let OpenStudy control Notes."
            : state === "permission"
              ? "Notes access was blocked. Allow it in System Settings, Privacy & Security, Automation, then try again."
              : state === "failed"
                ? "Could not read Notes. Is the Notes app set up on this Mac?"
                : summary || "Every note, in every folder. Notes you already added are skipped."}
        </p>
      </div>
      <button className="btn btn-sm" onClick={() => void run()} disabled={state === "reading"}>
        {state === "reading" ? <LoaderCircle size={18} className="animate-spin" /> : <NotebookText size={18} strokeWidth={2.5} />} Bring in Apple Notes
      </button>
    </section>
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
  const batch = useRef({ files: 0, pages: 0, empty: 0, skipped: 0, finished: 0, duplicates: 0 });
  const [dupes, setDupes] = useState(0);

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
        update((l) => logEvent(l, "import", { kind: "files", count: b.pages, skipped: b.empty + b.skipped, files: b.files, duplicates: b.duplicates }));
      }
    },
    [update],
  );
  const onPages = useCallback(
    (pages: LibPage[]) =>
      update((l) => {
        const r = addPages(l, pages);
        batch.current.pages += r.added;
        batch.current.duplicates += r.duplicates;
        if (r.duplicates) setDupes((d) => d + r.duplicates);
        return r.lib;
      }),
    [update],
  );

  useEffect(() => () => void importer.current?.dispose(), []);

  const [notesMsg, setNotesMsg] = useState("");
  const addFiles = async (all: File[]) => {
    // apple-notes.json from scripts/export-notes.mjs is read here, not by the file importer.
    const json = all.filter((f) => /\.json$/i.test(f.name) || f.type === "application/json");
    const files = all.filter((f) => !json.includes(f));
    for (const f of json) {
      let data: unknown = null;
      try {
        data = JSON.parse(await f.text());
      } catch {
        /* not JSON */
      }
      if (!isNotesExport(data)) {
        setNotesMsg(`${f.name} is not an Apple Notes export.`);
        continue;
      }
      let text = "";
      update((l) => {
        const r = addNotes(l, data.notes, "notes");
        text = r.summary;
        return r.lib;
      });
      setNotesMsg(text);
    }
    if (!files.length) return;
    if (!importer.current) {
      const { Importer } = await import("@/lib/importer");
      importer.current = new Importer({ onStatus, onPages, onWorker: setWorker });
    }
    if (batch.current.finished === batch.current.files) {
      batch.current = { files: 0, pages: 0, empty: 0, skipped: 0, finished: 0, duplicates: 0 };
      setDupes(0);
    }
    batch.current.files += files.length;
    const added = importer.current.add(files);
    setOrder((o) => [...o, ...added.map((a) => a.id)]);
  };

  const list = order.map((id) => items[id]).filter(Boolean);
  const finished = list.filter((i) => ["done", "empty", "skipped", "error"].includes(i.status)).length;
  // Duplicates were read but not kept, so they don't count as added.
  const pages = Math.max(0, list.reduce((s, i) => s + i.pages, 0) - dupes);
  const empty = list.filter((i) => i.status === "empty" || i.status === "error").length;
  const skipped = list.filter((i) => i.status === "skipped").length;
  const overall = list.length ? list.reduce((s, i) => s + (i.status === "queued" ? 0 : i.progress), 0) / list.length : 0;
  const summary = [
    `Added ${pages} page${pages === 1 ? "" : "s"} from ${list.length} file${list.length === 1 ? "" : "s"}.`,
    empty ? `${empty} had no readable text.` : "",
    skipped ? `${skipped} skipped (not book pages).` : "",
    dupLine(dupes).trim(),
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
        <span className="mt-2 max-w-[380px] text-[15px] text-muted">
          Text is read on this device. Keynote or Google Slides? Export to .pptx or .pdf first. Apple Notes: on a Mac, run <code className="font-bold">npm run notes:export</code> and drop apple-notes.json here.
        </span>
        <span className="btn btn-sm mt-5">
          <Upload size={18} strokeWidth={2.5} /> Choose files
        </span>
        <input
          type="file"
          multiple
          accept="image/*,.pdf,application/pdf,.pptx,.docx,.txt,.md,.markdown,.html,.htm,text/plain,text/markdown,text/html,.json,application/json"
          className="sr-only"
          data-testid="file-input"
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </label>

      {notesMsg && (
        <p className="anim-fade mt-4 flex items-center gap-2 font-bold text-ink" aria-live="polite">
          <CircleCheck size={20} strokeWidth={2.75} className="text-green" /> {notesMsg}
        </p>
      )}
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
  const [added, setAdded] = useState<{ count: number; books: number; words?: number; duplicates: number } | null>(null);
  const bridge = useMemo(() => (hasBridgeMarker(text) ? parseBridgeText(text) : null), [text]);
  const wordList = useMemo(() => {
    if (!text.trim() || bridge || /Excerpt From/i.test(text)) return null;
    const wl = parseWordList(text);
    return wl.isWordList ? wl.words : null;
  }, [text, bridge]);
  const parsed = useMemo(() => (text.trim() && !bridge && !wordList ? parseNotes(text) : []), [text, bridge, wordList]);
  const books = new Set(parsed.map((p) => p.suggestedTitle ?? "")).size;

  const [bridgeMsg, setBridgeMsg] = useState("");
  const addBridge = () => {
    let msg = "";
    update((l) => {
      const r = addNotes(l, bridge ?? [], "shortcut");
      msg = r.summary;
      return r.lib;
    });
    setBridgeMsg(msg);
    setText("");
  };

  const add = () => {
    const now = new Date().toISOString();
    const pages: LibPage[] = wordList
      ? [{ id: newId(), projectId: null, kind: "note", text: wordListText(text), words: wordList, heading: "Words", createdAt: now }]
      : parsed.map((p) => ({
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
    let duplicates = 0;
    update((l) => {
      const r = addPages(l, pages);
      count = r.added;
      duplicates = r.duplicates;
      return logEvent(r.lib, "import", { kind: wordList ? "words" : "note", count: r.added, skipped: pages.length - r.added, duplicates: r.duplicates });
    });
    setAdded({ count, books, words: wordList?.length, duplicates });
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
          {wordList ? `A word list with ${wordList.length} word${wordList.length === 1 ? "" : "s"}` : parsed.length ? `${parsed.length} excerpt${parsed.length === 1 ? "" : "s"}${books > 1 || parsed[0]?.suggestedTitle ? ` from ${books} book${books === 1 ? "" : "s"}` : ""}` : ""}
        </p>
      </div>
      {bridge ? (
        <button className="btn btn-block mt-5" disabled={!bridge.length} onClick={addBridge}>
          Add {bridge.length} note{bridge.length === 1 ? "" : "s"}
        </button>
      ) : wordList ? (
        <button className="btn btn-block mt-5" onClick={add}>
          Add {wordList.length} word{wordList.length === 1 ? "" : "s"}
        </button>
      ) : (
        <button className="btn btn-block mt-5" disabled={!parsed.length} onClick={add}>
          {parsed.length ? `Add ${parsed.length} excerpt${parsed.length === 1 ? "" : "s"}` : "Add excerpts"}
        </button>
      )}
      {bridgeMsg && (
        <p className="anim-fade mt-4 flex items-center gap-2 font-bold text-green">
          <CircleCheck size={20} strokeWidth={2.75} /> {bridgeMsg}
        </p>
      )}
      {added && (
        <p className="anim-fade mt-4 flex items-center gap-2 font-bold text-green">
          <CircleCheck size={20} strokeWidth={2.75} />
          {added.words && added.count ? ` Added a word list with ${added.words} word${added.words === 1 ? "" : "s"}.` : ` Added ${added.count} page${added.count === 1 ? "" : "s"}.`}
          {dupLine(added.duplicates)}
        </p>
      )}
    </div>
  );
}

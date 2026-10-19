"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createStore, get, set, del } from "idb-keyval";
import { emptyLibrary, normalizeLibrary } from "@/engine/library";
import type { Library } from "@/engine/types";

const LIB_KEY = "library-v1";
let libStore: ReturnType<typeof createStore> | null = null;
function store() {
  if (!libStore) libStore = createStore("openstudy", "library");
  return libStore;
}

export async function loadLibrary(): Promise<Library> {
  try {
    const raw = await get(LIB_KEY, store());
    return raw ? normalizeLibrary(raw) : emptyLibrary();
  } catch {
    return emptyLibrary();
  }
}

export async function saveLibrary(lib: Library): Promise<void> {
  await set(LIB_KEY, lib, store());
}

export async function clearLibrary(): Promise<void> {
  await del(LIB_KEY, store());
}

type Updater = (lib: Library) => Library;
type Ctx = { lib: Library; ready: boolean; update: (fn: Updater) => void; replace: (lib: Library) => void };

const LibraryContext = createContext<Ctx | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [lib, setLib] = useState<Library>(emptyLibrary);
  const [ready, setReady] = useState(false);
  const latest = useRef(lib);
  const queued = useRef(false);

  useEffect(() => {
    let alive = true;
    loadLibrary().then((l) => {
      if (!alive) return;
      latest.current = l;
      setLib(l);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Write on the next microtask: coalesces bursts of updates but starts the IndexedDB
  // transaction before any navigation can unload the page.
  const persist = useCallback(() => {
    if (queued.current) return;
    queued.current = true;
    queueMicrotask(() => {
      queued.current = false;
      void saveLibrary(latest.current);
    });
  }, []);

  const update = useCallback(
    (fn: Updater) => {
      const next = fn(latest.current);
      latest.current = next;
      setLib(next);
      persist();
    },
    [persist],
  );

  const replace = useCallback(
    (l: Library) => {
      latest.current = l;
      setLib(l);
      persist();
    },
    [persist],
  );

  return <LibraryContext.Provider value={{ lib, ready, update, replace }}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): Ctx {
  const c = useContext(LibraryContext);
  if (!c) throw new Error("useLibrary outside LibraryProvider");
  return c;
}

"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { getImage } from "@/lib/images";

/** Object URL for an image stored in IndexedDB (null until loaded or when missing). */
export function useImageUrl(key?: string): string | null {
  const [url, setUrl] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!key) return;
    let u: string | null = null;
    let alive = true;
    void getImage(key).then((b) => {
      if (!alive || !b) return;
      u = URL.createObjectURL(b);
      setUrl({ key, url: u });
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [key]);
  return url && url.key === key ? url.url : null;
}

/** Full screen view of a page image; click anywhere or press Escape to close. */
export function ImageViewer({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="Page image">
      <button aria-label="Close" className="absolute inset-0 cursor-zoom-out" onClick={onClose} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Your page" className="relative max-h-full max-w-full rounded-[12px] object-contain pointer-events-none" />
      <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white">
        <X size={22} strokeWidth={2.5} />
      </button>
    </div>
  );
}

/** Small "From your page" thumbnail (spec 11.1). Renders nothing until the image loads. */
export function SourceThumb({ imageKey, pageNumber, className = "" }: { imageKey?: string; pageNumber?: number; className?: string }) {
  const url = useImageUrl(imageKey);
  const [open, setOpen] = useState(false);
  if (!url) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className={`flex items-center gap-3 text-left ${className}`} aria-label="Open your page">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="max-h-[96px] w-auto max-w-[120px] rounded-[10px] border-2 border-line object-cover object-top" />
        <span className="text-[14px] font-bold text-muted">
          From your page{pageNumber ? ` p. ${pageNumber}` : ""}
        </span>
      </button>
      {open && <ImageViewer url={url} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The large image a picture exercise is about. Tap to open full screen. */
export function PictureFrame({ imageKey }: { imageKey?: string }) {
  const url = useImageUrl(imageKey);
  const [open, setOpen] = useState(false);
  if (!url) return <div className="aspect-[4/3] w-full rounded-[14px] border-2 border-line bg-shelf" aria-label="Loading picture" />;
  return (
    <>
      <button onClick={() => setOpen(true)} className="block w-full cursor-zoom-in" aria-label="Open the picture full screen">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Your page" className="max-h-[46dvh] w-full rounded-[14px] border-2 border-line bg-shelf object-contain" />
      </button>
      {open && <ImageViewer url={url} onClose={() => setOpen(false)} />}
    </>
  );
}

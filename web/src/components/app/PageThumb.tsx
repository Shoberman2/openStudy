"use client";

import { useEffect, useState } from "react";
import type { Page } from "@/engine/types";
import { getImage } from "@/lib/images";

/** Thumbnail for a screenshot page, or a small serif text card for notes. */
export function PageThumb({ page, className = "" }: { page: Page; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!page.image) return;
    let u: string | null = null;
    let alive = true;
    void getImage(page.image).then((b) => {
      if (!alive || !b) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [page.image]);
  if (url)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`aspect-[9/16] w-full rounded-[10px] border-2 border-line object-cover object-top ${className}`} />;
  return (
    <div className={`${page.text.length > 260 ? "aspect-[9/16]" : "aspect-[3/4]"} w-full overflow-hidden rounded-[10px] border-2 border-line bg-[var(--page-paper)] p-2 pt-7 ${className}`}>
      {page.header && <p className="mb-1 truncate text-center text-[8px] font-bold text-muted">{page.header}</p>}
      <p className={`serif leading-[1.35] text-ink/80 ${page.text.length > 260 ? "text-[9px]" : "text-[12px]"}`}>{page.text.slice(0, 420)}</p>
    </div>
  );
}

"use client";

import { buildOffline, type BuildResult } from "@/engine/builder";
import { buildProject, type ClassPage } from "@/engine/classbuilder";
import { groupPages, type GroupPage, type SuggestedGroup } from "@/engine/grouping";
import type { Profile, ProjectType } from "@/engine/types";

let health: Promise<boolean> | null = null;

export function smartOrganizeOn(): Promise<boolean> {
  if (!health)
    health = fetch("/api/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { ai: false }))
      .then((j: { ai?: boolean }) => !!j.ai)
      .catch(() => false);
  return health;
}

async function post<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** Smart organize when the server has a key, else the offline grouping. */
export async function suggestGroups(pages: GroupPage[]): Promise<{ groups: SuggestedGroup[]; smart: boolean }> {
  const offline = () => ({ groups: groupPages(pages), smart: false });
  // Pages with an exact Notes title never need the model.
  if (!pages.length || pages.every((p) => p.suggestedTitle)) return offline();
  if (!(await smartOrganizeOn())) return offline();
  const res = await post<{ groups: { title: string; author?: string; pageIds: string[]; type?: ProjectType }[] }>("/api/sort", {
    pages: pages.map((p) => ({ id: p.id, header: p.header ?? p.heading, source: p.sourceName, text: p.text.slice(0, 700) })),
  });
  if (!res?.groups?.length) return offline();
  const offlineTypes = groupPages(pages);
  const typeOf = (ids: string[]) => offlineTypes.find((g) => g.pageIds.some((id) => ids.includes(id)))?.type;
  return {
    groups: res.groups.map((g, i) => ({ key: `ai${i}`, title: g.title, author: g.author, pageIds: g.pageIds, type: g.type ?? typeOf(g.pageIds) })),
    smart: true,
  };
}

export async function buildLessons(
  project: { title: string; author?: string; type?: ProjectType },
  pages: ClassPage[],
  profile: Profile,
): Promise<{ result: BuildResult; smart: boolean }> {
  const offline = () => ({ result: buildProject(project, pages), smart: false });
  if (!(await smartOrganizeOn())) return offline();
  const res = await post<BuildResult>("/api/build", {
    project: { title: project.title, author: project.author, type: project.type },
    pages: pages.map((p) => ({ id: p.id, text: [p.heading, p.text].filter(Boolean).join("\n") })),
    profile: { goals: profile.goals, practice: profile.practice },
    wantQuotes: true,
  });
  if (!res?.lessons?.length) return offline();
  // Keep offline verbatim excerpts as quote candidates too.
  const off = project.type === "class" ? { quotes: [] } : buildOffline(project, pages);
  const seen = new Set(res.quotes.map((q) => q.text.toLowerCase()));
  const quotes = [...res.quotes, ...off.quotes.filter((q) => !seen.has(q.text.toLowerCase()))].slice(0, 20);
  return { result: { lessons: res.lessons, quotes }, smart: true };
}

/** Read an image with Claude vision (spec 8.2). Returns null when unavailable so callers fall back to OCR. */
export async function readImageSmart(canvas: HTMLCanvasElement): Promise<{ text: string; heading?: string } | null> {
  if (!(await smartOrganizeOn())) return null;
  const scale = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * scale);
  c.height = Math.round(canvas.height * scale);
  c.getContext("2d")!.drawImage(canvas, 0, 0, c.width, c.height);
  const image = c.toDataURL("image/jpeg", 0.85).split(",")[1];
  const res = await post<{ text?: string; heading?: string }>("/api/read", { image, mediaType: "image/jpeg" });
  if (!res?.text?.trim()) return null;
  return { text: res.text, heading: res.heading || undefined };
}

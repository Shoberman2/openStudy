// Usage data (spec 12.3): which local events go to the server, and how the server cleans them.
// Only categories and counts leave the device, never page text, titles or file names.
import type { LibEvent } from "./types";

export const MAX_BATCH = 200;

const NAME = /^[a-z_]{2,40}$/;
const STRING_KEYS = new Set([
  "kind", "source", "scope", "from", "type", "category", "types", "categories", "lessonKind", "goal", "practice", "bringing",
]);
const VALUE_KEYS = new Set([
  "level", "dailyGoalXP", "count", "pages", "lessons", "projects", "files", "skipped", "duplicates", "checked", "found",
  "accuracy", "seconds", "xp", "questions", "yes", "ok", "smart", "grounded", "groups", "books", "classes", "others", "words",
]);
const DAY = 86_400_000;

export type CleanEvent = { t: string; name: string; props: Record<string, string | number | boolean> };

/** Keeps allowlisted props: strings (60 chars max) for category keys, numbers and booleans for counts. */
export function cleanProps(props: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props || typeof props !== "object") return out;
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (STRING_KEYS.has(k) && typeof v === "string") out[k] = v.slice(0, 60);
    else if (STRING_KEYS.has(k) && typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (VALUE_KEYS.has(k) && ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean")) out[k] = v;
  }
  return out;
}

/** Server side: drops malformed events and those outside [now - 30 days, now + 1 day]. */
export function cleanEvents(raw: unknown, now: Date = new Date()): CleanEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: CleanEvent[] = [];
  for (const e of raw.slice(0, MAX_BATCH)) {
    if (!e || typeof e !== "object") continue;
    const { t, name, props } = e as Record<string, unknown>;
    if (typeof name !== "string" || !NAME.test(name) || typeof t !== "string") continue;
    const ms = Date.parse(t);
    if (!Number.isFinite(ms) || ms < now.getTime() - 30 * DAY || ms > now.getTime() + DAY) continue;
    out.push({ t: new Date(ms).toISOString(), name, props: cleanProps(props) });
  }
  return out;
}

/** Client side: the next batch after `cursor` (the `t` of the last event sent). */
export function pendingEvents(events: LibEvent[], cursor: string | null): LibEvent[] {
  return events.filter((e) => !cursor || e.t > cursor).slice(0, MAX_BATCH);
}

/** File type group for the `types` prop of a files import. */
export function fileTypeGroup(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "heic", "heif", "webp", "gif", "tif", "tiff", "bmp"].includes(ext)) return "image";
  if (["pptx", "ppt", "key"].includes(ext)) return "pptx";
  if (["docx", "doc"].includes(ext)) return "docx";
  if (["txt", "md", "markdown", "html", "htm", "rtf"].includes(ext)) return "text";
  if (ext === "json") return "json";
  return "other";
}

/** "pdf:2,image:5", most common first. */
export function typesSummary(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(fileTypeGroup(n), (counts.get(fileTypeGroup(n)) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
}

/** The `sort_done` props for a set of groups. */
export function sortDoneProps(groups: { type?: string; category?: string; pageIds: string[] }[]): Record<string, string | number> {
  const cats = [...new Set(groups.map((g) => g.category).filter((c): c is string => !!c))];
  return {
    pages: groups.reduce((n, g) => n + g.pageIds.length, 0),
    groups: groups.length,
    books: groups.filter((g) => g.type === "book").length,
    classes: groups.filter((g) => g.type === "class").length,
    others: groups.filter((g) => g.type !== "book" && g.type !== "class").length,
    categories: cats.join(",").slice(0, 60),
  };
}

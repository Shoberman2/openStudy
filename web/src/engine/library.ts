// Library-level operations: creation, sample data, applying builds, merge import, events.
import type { BuildResult, QuoteDraft } from "./builder";
import { newSrs } from "./srs";
import { normalizeForDedupe } from "./text";
import {
  PROJECT_COLORS,
  type Bringing,
  type Card,
  type LibEvent,
  type Lesson,
  type Library,
  type Page,
  type Project,
  type ProjectColor,
} from "./types";
import { addDays, localDay, newId } from "./util";

export function emptyLibrary(): Library {
  return {
    version: 1,
    profile: { onboarded: false, bringing: ["books"], goals: ["ideas"], practice: ["tap"], dailyGoalXP: 20 },
    stats: { xp: 0, streak: 0, longestStreak: 0, freezes: 0, dayXP: {} },
    projects: [],
    pages: [],
    lessons: [],
    cards: [],
    events: [],
  };
}

type RawCard = Omit<Card, "srs"> & { srs?: Card["srs"] };
type RawLibrary = Partial<Omit<Library, "cards">> & { cards?: RawCard[] };

/** Fill defaults and initialize missing SRS (sample cards ship without srs). */
/** v1 clients stored a single string; v2 stores a list (spec 8.1). */
export function normalizeBringing(v: unknown): Bringing[] {
  const ok: Bringing[] = ["books", "class", "anything"];
  if (Array.isArray(v)) {
    const out = v.filter((x): x is Bringing => ok.includes(x as Bringing));
    return out.length ? out : ["books"];
  }
  if (typeof v === "string") return ok.includes(v as Bringing) ? [v as Bringing] : ["books"];
  return ["books"];
}

export function normalizeLibrary(raw: RawLibrary, now: Date = new Date()): Library {
  const base = emptyLibrary();
  const rawProfile = (raw.profile ?? {}) as Partial<Library["profile"]> & { bringing?: unknown };
  return {
    version: 1,
    profile: { ...base.profile, ...rawProfile, bringing: normalizeBringing(rawProfile.bringing) },
    stats: { ...base.stats, ...(raw.stats ?? {}), dayXP: { ...(raw.stats?.dayXP ?? {}) } },
    projects: (raw.projects ?? []).map((p) => ({ ...p, type: p.type ?? "book" })),
    pages: raw.pages ?? [],
    lessons: raw.lessons ?? [],
    cards: (raw.cards ?? []).map((c) => ({ ...c, srs: c.srs ?? newSrs(now) })),
    events: raw.events ?? [],
  };
}

export function nextColor(lib: Library): ProjectColor {
  return PROJECT_COLORS[lib.projects.length % PROJECT_COLORS.length];
}

export function logEvent(lib: Library, name: string, props?: LibEvent["props"], now: Date = new Date()): Library {
  return { ...lib, events: [...lib.events, { t: now.toISOString(), name, ...(props ? { props } : {}) }] };
}

/** Add the sample projects (ids are fixed, so adding twice is a no-op). */
export const SAMPLE_CLASS_ID = "smpbio101";

export function addSample(lib: Library, sample: RawLibrary, now: Date = new Date()): Library {
  const s = normalizeLibrary(sample, now);
  // The sample class gets an exam 10 days out so the plan and practice test are visible (spec 8.7).
  const goal = localDay(addDays(now, 10));
  s.projects = s.projects
    .filter((p) => !lib.projects.some((x) => x.id === p.id))
    .map((p) => (p.id === SAMPLE_CLASS_ID ? { ...p, goalDate: goal } : p));
  const keep = new Set(s.projects.map((p) => p.id));
  const incoming: Library = {
    ...s,
    pages: s.pages.filter((x) => x.projectId && keep.has(x.projectId)),
    lessons: s.lessons.filter((x) => keep.has(x.projectId)),
    cards: s.cards.filter((x) => keep.has(x.projectId)),
  };
  return mergeLibrary(lib, incoming);
}

/** Merge another library into this one by id (import). Existing records are replaced by incoming ones. */
export function mergeLibrary(lib: Library, incoming: Library): Library {
  const merge = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const m = new Map(a.map((x) => [x.id, x]));
    for (const x of b) m.set(x.id, { ...m.get(x.id), ...x });
    return [...m.values()];
  };
  const eventKey = (e: LibEvent) => e.t + e.name;
  const seenEvents = new Set(lib.events.map(eventKey));
  const dayXP = { ...lib.stats.dayXP };
  for (const [d, x] of Object.entries(incoming.stats.dayXP ?? {})) dayXP[d] = Math.max(dayXP[d] ?? 0, x);
  const later = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b);
  return {
    ...lib,
    profile: lib.profile.onboarded ? lib.profile : { ...incoming.profile },
    stats: {
      xp: Math.max(lib.stats.xp, incoming.stats.xp),
      streak: later(lib.stats.lastActiveDay, incoming.stats.lastActiveDay) === lib.stats.lastActiveDay ? lib.stats.streak : incoming.stats.streak,
      longestStreak: Math.max(lib.stats.longestStreak, incoming.stats.longestStreak),
      lastActiveDay: later(lib.stats.lastActiveDay, incoming.stats.lastActiveDay),
      freezes: Math.max(lib.stats.freezes, incoming.stats.freezes),
      dayXP,
    },
    projects: merge(lib.projects, incoming.projects),
    pages: merge(lib.pages, incoming.pages),
    lessons: merge(lib.lessons, incoming.lessons),
    cards: merge(lib.cards, incoming.cards),
    events: [...lib.events, ...incoming.events.filter((e) => !seenEvents.has(eventKey(e)))].sort((a, b) => a.t.localeCompare(b.t)),
  };
}

/** Export form: strips local image keys (not portable). */
export function exportLibrary(lib: Library): Library {
  return {
    ...lib,
    pages: lib.pages.map((p) => {
      const copy = { ...p };
      delete copy.image;
      return copy;
    }),
  };
}

export type CreatedLessons = { lessons: Lesson[]; cards: Card[] };

/**
 * Turn a build result into lessons and cards for a project. The Quotes lesson (if any quotes were
 * kept) sits right after the first theme lesson.
 */
export function materialize(
  projectId: string,
  result: BuildResult,
  quotes: QuoteDraft[],
  opts: { now?: Date; startOrder?: number; existingQuotesLessonId?: string; existingStatements?: Set<string> } = {},
): CreatedLessons {
  const now = opts.now ?? new Date();
  const lessons: Lesson[] = [];
  const cards: Card[] = [];
  const seen = opts.existingStatements ?? new Set<string>();
  let order = opts.startOrder ?? 0;
  let quotesLessonId = opts.existingQuotesLessonId;
  const addQuotesLesson = () => {
    if (quotesLessonId || !quotes.length) return;
    quotesLessonId = newId();
    lessons.push({ id: quotesLessonId, projectId, title: "Quotes", summary: "The lines worth knowing word for word.", kind: "quotes", order: order++, level: 0, sessions: 0 });
  };
  result.lessons.forEach((l, i) => {
    const lessonId = newId();
    const lessonCards: Card[] = [];
    for (const c of l.cards) {
      const key = normalizeForDedupe(c.statement);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      lessonCards.push({
        id: newId(),
        lessonId,
        projectId,
        pageId: c.pageId,
        kind: "fact",
        statement: c.statement,
        cloze: c.cloze,
        question: c.question,
        answer: c.answer,
        distractors: c.distractors,
        falseStatement: c.falseStatement,
        ...(c.term ? { term: c.term, definition: c.definition } : {}),
        srs: newSrs(now),
      });
    }
    if (!lessonCards.length) return;
    lessons.push({ id: lessonId, projectId, title: l.title, summary: l.summary, kind: "theme", order: order++, level: 0, sessions: 0 });
    cards.push(...lessonCards);
    if (i === 0) addQuotesLesson();
  });
  addQuotesLesson();
  if (quotesLessonId) {
    const qseen = new Set<string>();
    for (const q of quotes) {
      const key = "q:" + normalizeForDedupe(q.text);
      if (seen.has(key) || qseen.has(key)) continue;
      qseen.add(key);
      seen.add(key);
      cards.push({ id: newId(), lessonId: quotesLessonId, projectId, pageId: q.pageId, kind: "quote", statement: q.text, attribution: q.attribution, srs: newSrs(now) });
    }
  }
  return { lessons, cards };
}

export function createProject(
  lib: Library,
  p: { title: string; author?: string; focus: Project["focus"]; quotesAsked: boolean; type?: Project["type"]; goalDate?: string },
  pageIds: string[],
  built: CreatedLessons & { projectId: string },
  now: Date = new Date(),
): Library {
  const project: Project = {
    id: built.projectId,
    title: p.title.trim() || "Untitled",
    author: p.author?.trim() || undefined,
    color: nextColor(lib),
    createdAt: now.toISOString(),
    focus: p.focus,
    quotesAsked: p.quotesAsked,
    type: p.type ?? "book",
    goalDate: p.goalDate,
  };
  const ids = new Set(pageIds);
  return {
    ...lib,
    projects: [...lib.projects, project],
    pages: lib.pages.map((pg) => (ids.has(pg.id) ? { ...pg, projectId: project.id } : pg)),
    lessons: [...lib.lessons, ...built.lessons],
    cards: [...lib.cards, ...built.cards],
  };
}

/** Add more pages to an existing project: new lessons go after the current ones. */
export function extendProject(lib: Library, projectId: string, pageIds: string[], result: BuildResult, quotes: QuoteDraft[], now: Date = new Date()): Library {
  const lessons = lib.lessons.filter((l) => l.projectId === projectId);
  const startOrder = lessons.reduce((m, l) => Math.max(m, l.order + 1), 0);
  const existingQuotes = lessons.find((l) => l.kind === "quotes");
  const existing = new Set(
    lib.cards.filter((c) => c.projectId === projectId).map((c) => (c.kind === "quote" ? "q:" : "") + normalizeForDedupe(c.statement)),
  );
  const titles = new Set(lessons.map((l) => l.title.toLowerCase()));
  const renamed: BuildResult = {
    ...result,
    lessons: result.lessons.map((l) => {
      let t = l.title;
      for (let i = 2; titles.has(t.toLowerCase()); i++) t = `${l.title} ${i}`;
      titles.add(t.toLowerCase());
      return { ...l, title: t };
    }),
  };
  const built = materialize(projectId, renamed, existingQuotes || quotes.length ? quotes : [], {
    now,
    startOrder,
    existingQuotesLessonId: existingQuotes?.id,
    existingStatements: existing,
  });
  const ids = new Set(pageIds);
  return {
    ...lib,
    pages: lib.pages.map((pg) => (ids.has(pg.id) ? { ...pg, projectId } : pg)),
    lessons: [...lib.lessons, ...built.lessons],
    cards: [...lib.cards, ...built.cards],
  };
}

export function projectLessons(lib: Library, projectId: string): Lesson[] {
  return lib.lessons.filter((l) => l.projectId === projectId).sort((a, b) => a.order - b.order);
}

/** Theme lessons unlock when the previous theme lesson has level >= 1; quotes are always open. */
export function unlockedIds(lessons: Lesson[]): Set<string> {
  const out = new Set<string>();
  let prevOk = true;
  for (const l of lessons) {
    if (l.kind === "quotes") {
      out.add(l.id);
      continue;
    }
    if (prevOk) out.add(l.id);
    prevOk = prevOk && l.level >= 1;
  }
  return out;
}

export function currentLesson(lessons: Lesson[]): Lesson | undefined {
  const open = unlockedIds(lessons);
  const avail = lessons.filter((l) => open.has(l.id));
  return avail.find((l) => l.level === 0 && l.kind === "theme") ?? avail.find((l) => l.level === 0) ?? avail.slice().sort((a, b) => a.level - b.level || a.order - b.order)[0];
}

/** "Continue" target: next unfinished lesson of the most recently studied (or created) project. */
export function continueTarget(lib: Library): { project: Project; lesson: Lesson } | null {
  if (!lib.projects.length) return null;
  const lastStart = [...lib.events].reverse().find((e) => e.name === "session_start" && e.props?.projectId);
  const recent =
    lib.projects.find((p) => p.id === lastStart?.props?.projectId) ??
    lib.projects.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const order = [recent, ...lib.projects.filter((p) => p.id !== recent.id)];
  for (const p of order) {
    const lesson = currentLesson(projectLessons(lib, p.id));
    if (lesson) return { project: p, lesson };
  }
  return null;
}

export function weekStats(lib: Library, now: Date = new Date()) {
  const days = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = localDay(d);
    if ((lib.stats.dayXP[key] ?? 0) > 0) days.add(key);
  }
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const done = lib.events.filter((e) => (e.name === "session_done" || e.name === "review_done") && e.t >= since);
  const accs = done.map((e) => e.props?.accuracy).filter((x): x is number => typeof x === "number");
  const due = lib.cards.filter((c) => c.srs.state !== "new" && new Date(c.srs.due) <= now).length;
  return {
    daysActive: days.size,
    sessions: done.length,
    accuracy: accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null,
    due,
  };
}

export function inboxPages(lib: Library): Page[] {
  return lib.pages.filter((p) => p.projectId === null);
}

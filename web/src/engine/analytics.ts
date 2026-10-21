// Owner analytics for the OpenStudy MCP (spec 12.4). Pure functions over stored event rows, so the
// numbers are tested here and the MCP route only loads rows and formats answers.

export type EventRow = {
  t: string;
  install_id: string;
  user_id: string | null;
  platform: string;
  name: string;
  props: Record<string, string | number | boolean>;
};
export type Account = { id: string; email?: string; created_at: string };
export type PlusRow = { user_id: string; status: string };

const DAY = 86_400_000;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown, fallback = "unknown") => (typeof v === "string" && v ? v : fallback);

function countBy<T>(items: T[], key: (x: T) => string, weight: (x: T) => number = () => 1): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of items) out[key(x)] = (out[key(x)] ?? 0) + weight(x);
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

export const since = (now: Date, days: number) => new Date(now.getTime() - days * DAY).toISOString();

export function overview(rows: EventRow[], accounts: Account[], plus: PlusRow[], now: Date, days: number) {
  const from = since(now, days);
  const recent = rows.filter((r) => r.t >= from);
  const installs = new Map<string, string>();
  for (const r of recent) installs.set(r.install_id, r.platform);
  return {
    window: `${days} days`,
    accounts: { total: accounts.length, new: accounts.filter((a) => a.created_at >= from).length },
    activeInstalls: { total: installs.size, byPlatform: countBy([...installs.values()], (p) => p) },
    plus: countBy(plus, (p) => p.status),
    events: recent.length,
    topEvents: Object.fromEntries(Object.entries(countBy(recent, (r) => r.name)).slice(0, 10)),
  };
}

/** "pdf:2,image:5" -> {pdf: 2, image: 5}. */
function parseTypes(s: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof s !== "string") return out;
  for (const part of s.split(",")) {
    const [k, v] = part.split(":");
    if (k) out[k] = (out[k] ?? 0) + (Number(v) || 0);
  }
  return out;
}

export function uploads(rows: EventRow[], now: Date, days: number) {
  const from = since(now, days);
  const imports = rows.filter((r) => r.name === "import" && r.t >= from);
  const fileTypes: Record<string, number> = {};
  for (const r of imports) for (const [k, v] of Object.entries(parseTypes(r.props.types))) fileTypes[k] = (fileTypes[k] ?? 0) + v;
  const byDay = countBy(imports, (r) => r.t.slice(0, 10), (r) => num(r.props.count));
  return {
    window: `${days} days`,
    imports: imports.length,
    installsImporting: new Set(imports.map((r) => r.install_id)).size,
    pagesAdded: imports.reduce((n, r) => n + num(r.props.count), 0),
    skipped: imports.reduce((n, r) => n + num(r.props.skipped), 0),
    duplicates: imports.reduce((n, r) => n + num(r.props.duplicates), 0),
    byKind: countBy(imports, (r) => str(r.props.kind)),
    pagesByKind: countBy(imports, (r) => str(r.props.kind), (r) => num(r.props.count)),
    fileTypes: Object.fromEntries(Object.entries(fileTypes).sort((a, b) => b[1] - a[1])),
    byPlatform: countBy(imports, (r) => r.platform),
    pagesByDay: Object.fromEntries(Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]))),
    photoSweeps: rows
      .filter((r) => r.name === "library_scan" && r.t >= from)
      .reduce((a, r) => ({ runs: a.runs + 1, checked: a.checked + num(r.props.checked), found: a.found + num(r.props.found) }), { runs: 0, checked: 0, found: 0 }),
  };
}

export function sorting(rows: EventRow[], now: Date, days: number) {
  const from = since(now, days);
  const inWindow = rows.filter((r) => r.t >= from);
  const created = inWindow.filter((r) => r.name === "project_created");
  const sorts = inWindow.filter((r) => r.name === "sort_done");
  const sortCats: Record<string, number> = {};
  for (const s of sorts)
    for (const c of str(s.props.categories, "").split(",").filter(Boolean)) sortCats[c] = (sortCats[c] ?? 0) + 1;
  const imported = inWindow.filter((r) => r.name === "import").reduce((n, r) => n + num(r.props.count), 0);
  const filed =
    created.reduce((n, r) => n + num(r.props.pages), 0) + inWindow.filter((r) => r.name === "pages_added").reduce((n, r) => n + num(r.props.pages), 0);
  return {
    window: `${days} days`,
    projectsCreated: created.length,
    projectsByType: countBy(created, (r) => str(r.props.type)),
    projectsByCategory: countBy(created, (r) => str(r.props.category)),
    pagesByCategory: countBy(created, (r) => str(r.props.category), (r) => num(r.props.pages)),
    sortScreens: sorts.length,
    sortGroupMix: {
      books: sorts.reduce((n, r) => n + num(r.props.books), 0),
      classes: sorts.reduce((n, r) => n + num(r.props.classes), 0),
      others: sorts.reduce((n, r) => n + num(r.props.others), 0),
    },
    categoriesSuggested: Object.fromEntries(Object.entries(sortCats).sort((a, b) => b[1] - a[1])),
    categoryChangedTo: countBy(inWindow.filter((r) => r.name === "category_changed"), (r) => str(r.props.category)),
    organizeAllRuns: inWindow.filter((r) => r.name === "organize_all").length,
    pagesImported: imported,
    pagesFiledIntoProjects: filed,
    shareFiled: imported ? Math.round((filed / imported) * 100) / 100 : null,
  };
}

/** Monday of the week (UTC) as YYYY-MM-DD. */
export function weekOf(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const ACTIVE_PLUS = new Set(["trialing", "active", "comp"]);

/** Weekly install cohorts: share of installs reaching each step (spec 12.4). */
export function funnel(rows: EventRow[], plus: PlusRow[], now: Date, weeks: number) {
  const first = new Map<string, string>();
  const users = new Map<string, string>();
  const did = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!first.has(r.install_id) || r.t < first.get(r.install_id)!) first.set(r.install_id, r.t);
    if (r.user_id) users.set(r.install_id, r.user_id);
    if (!did.has(r.install_id)) did.set(r.install_id, new Set());
    did.get(r.install_id)!.add(r.name);
  }
  const onPlus = new Set(plus.filter((p) => ACTIVE_PLUS.has(p.status)).map((p) => p.user_id));
  const cutoff = weekOf(since(now, weeks * 7));
  const cohorts = new Map<string, string[]>();
  for (const [id, t] of first) {
    const w = weekOf(t);
    if (w < cutoff) continue;
    cohorts.set(w, [...(cohorts.get(w) ?? []), id]);
  }
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  return [...cohorts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, ids]) => {
      const has = (pred: (id: string) => boolean) => pct(ids.filter(pred).length, ids.length);
      const any = (id: string, names: string[]) => names.some((n) => did.get(id)?.has(n));
      return {
        week,
        installs: ids.length,
        importedPct: has((id) => any(id, ["import", "library_scan"])),
        projectPct: has((id) => any(id, ["project_created", "organize_all"])),
        studiedPct: has((id) => any(id, ["session_done", "review_done"])),
        signedUpPct: has((id) => users.has(id)),
        plusPct: has((id) => onPlus.has(users.get(id) ?? "")),
      };
    });
}

export function study(rows: EventRow[], now: Date, days: number) {
  const from = since(now, days);
  const done = rows.filter((r) => (r.name === "session_done" || r.name === "review_done") && r.t >= from);
  const starts = rows.filter((r) => r.name === "session_start" && r.t >= from);
  const acc = done.filter((r) => typeof r.props.accuracy === "number");
  return {
    window: `${days} days`,
    sessionsStarted: starts.length,
    sessionsFinished: done.filter((r) => r.name === "session_done").length,
    reviewsFinished: done.filter((r) => r.name === "review_done").length,
    studyingInstalls: new Set(done.map((r) => r.install_id)).size,
    averageAccuracy: acc.length ? Math.round((acc.reduce((n, r) => n + num(r.props.accuracy), 0) / acc.length) * 100) / 100 : null,
    minutes: Math.round(done.reduce((n, r) => n + num(r.props.seconds), 0) / 60),
    xp: done.reduce((n, r) => n + num(r.props.xp), 0),
    startsByLessonKind: countBy(starts, (r) => str(r.props.lessonKind)),
    practiceTests: rows.filter((r) => r.name === "test_done" && r.t >= from).length,
    asks: rows.filter((r) => r.name === "ask" && r.t >= from).length,
    // Spec 13: how often sessions ask about ideas, and what people choose to focus on.
    avgConceptQuestions: avg(starts.filter((r) => typeof r.props.concepts === "number").map((r) => num(r.props.concepts))),
    focus: (() => {
      const set = rows.filter((r) => r.name === "focus_set" && r.t >= from);
      const picked = set.filter((r) => num(r.props.chosen) > 0);
      return {
        set: set.length,
        everything: set.length - picked.length,
        avgChosen: avg(picked.map((r) => num(r.props.chosen))),
        avgOffered: avg(set.map((r) => num(r.props.offered))),
      };
    })(),
  };
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

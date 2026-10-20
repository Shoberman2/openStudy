// Connections across projects (spec 10.8). Idea from BookSaver `LocalStudyAgent.connections`.
import { cosine, tfidf } from "./tfidf";
import { tokens } from "./text";
import type { Card, Lesson, Project } from "./types";

export type LessonDoc = { id: string; projectId: string; title: string; statements: string[] };
export type Connection = { projects: [string, string]; lessons: [string, string]; terms: string[]; score: number };

export const CONNECTION_MIN = 0.15;

export function findConnections(docs: LessonDoc[], max = 3): Connection[] {
  if (docs.length < 2) return [];
  const toks = docs.map((d) => d.statements.flatMap((s) => tokens(s)));
  const { vecs } = tfidf(toks.map((ts) => ts.map((t) => t.stem)));
  const surfaces = new Map<string, Map<string, number>>();
  for (const ts of toks)
    for (const t of ts) {
      const m = surfaces.get(t.stem) ?? new Map<string, number>();
      m.set(t.surface, (m.get(t.surface) ?? 0) + 1);
      surfaces.set(t.stem, m);
    }
  const surface = (stem: string) => {
    let best = stem;
    let bc = 0;
    for (const [s, c] of surfaces.get(stem) ?? []) if (c > bc || (c === bc && s < best)) [best, bc] = [s, c];
    return best;
  };
  const best = new Map<string, Connection>();
  for (let i = 0; i < docs.length; i++)
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i];
      const b = docs[j];
      if (a.projectId === b.projectId) continue;
      const score = cosine(vecs[i], vecs[j]);
      if (score < CONNECTION_MIN) continue;
      const key = [a.projectId, b.projectId].sort().join("|");
      const cur = best.get(key);
      if (cur && cur.score >= score) continue;
      const shared = [...vecs[i].keys()]
        .filter((t) => vecs[j].has(t))
        .sort((x, y) => vecs[j].get(y)! * vecs[i].get(y)! - vecs[j].get(x)! * vecs[i].get(x)! || x.localeCompare(y))
        .slice(0, 3)
        .map(surface);
      best.set(key, { projects: [a.projectId, b.projectId], lessons: [a.id, b.id], terms: shared, score });
    }
  return [...best.values()].sort((x, y) => y.score - x.score).slice(0, max);
}

/** Connections for Home: theme lessons of non-sample projects (the sample counts only when it is all there is). */
export function libraryConnections(projects: Project[], lessons: Lesson[], cards: Card[]): Connection[] {
  const real = projects.filter((p) => !p.sample);
  const use = new Set((real.length >= 2 ? real : projects).map((p) => p.id));
  const docs: LessonDoc[] = lessons
    .filter((l) => l.kind === "theme" && use.has(l.projectId))
    .sort((a, b) => a.order - b.order)
    .map((l) => ({ id: l.id, projectId: l.projectId, title: l.title, statements: cards.filter((c) => c.lessonId === l.id).map((c) => c.statement) }))
    .filter((d) => d.statements.length);
  if (new Set(docs.map((d) => d.projectId)).size < 2) return [];
  return findConnections(docs);
}

/** "a, b and c". */
export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

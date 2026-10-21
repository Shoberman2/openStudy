import { describe, expect, it } from "vitest";
import { funnel, overview, sorting, uploads, weekOf, type EventRow } from "./analytics";
import { cleanEvents, cleanProps, pendingEvents, sortDoneProps, typesSummary } from "./events";

const NOW = new Date("2026-10-21T12:00:00Z");
const row = (t: string, install: string, name: string, props: EventRow["props"] = {}, user: string | null = null): EventRow => ({
  t,
  install_id: install,
  user_id: user,
  platform: "ios",
  name,
  props,
});

describe("usage data cleaning (12.3)", () => {
  it("keeps categories and counts, drops text", () => {
    expect(cleanProps({ kind: "photo", count: 3, title: "Atomic Habits", text: "secret", projectId: "p1", smart: true, xp: "9" })).toEqual({
      kind: "photo",
      count: 3,
      smart: true,
    });
    expect(cleanProps({ category: "x".repeat(80) }).category).toHaveLength(60);
  });

  it("drops bad names and out-of-window times", () => {
    const out = cleanEvents(
      [
        { t: "2026-10-21T11:00:00Z", name: "import", props: { kind: "photo" } },
        { t: "2026-10-21T11:00:00Z", name: "Bad-Name" },
        { t: "2026-08-01T00:00:00Z", name: "import" },
        { t: "2026-10-25T00:00:00Z", name: "import" },
        { t: "nope", name: "import" },
        "junk",
      ],
      NOW,
    );
    expect(out).toEqual([{ t: "2026-10-21T11:00:00.000Z", name: "import", props: { kind: "photo" } }]);
  });

  it("sends only events after the cursor, 200 at most", () => {
    const evs = Array.from({ length: 300 }, (_, i) => ({ t: `2026-10-21T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`, name: "x" }));
    expect(pendingEvents(evs, null)).toHaveLength(200);
    expect(pendingEvents(evs, evs[249].t)).toHaveLength(50);
  });

  it("summarizes file types and sort groups", () => {
    expect(typesSummary(["a.pdf", "b.PNG", "c.jpg", "d.pptx", "e.pdf", "f.jpeg"])).toBe("image:3,pdf:2,pptx:1");
    expect(
      sortDoneProps([
        { type: "book", category: "Reading", pageIds: ["1", "2"] },
        { type: "class", category: "Biology", pageIds: ["3"] },
        { type: "other", category: "Reading", pageIds: ["4"] },
      ]),
    ).toEqual({ pages: 4, groups: 3, books: 1, classes: 1, others: 1, categories: "Reading,Biology" });
  });
});

describe("owner analytics (12.4)", () => {
  const rows: EventRow[] = [
    row("2026-10-13T10:00:00Z", "a", "app_open"),
    row("2026-10-13T10:05:00Z", "a", "import", { kind: "files", count: 5, types: "pdf:2,image:3", duplicates: 1 }),
    row("2026-10-13T10:10:00Z", "a", "project_created", { type: "class", category: "Biology", pages: 4 }, "u1"),
    row("2026-10-14T10:00:00Z", "a", "session_done", { accuracy: 0.8, seconds: 120, xp: 20 }, "u1"),
    row("2026-10-20T09:00:00Z", "b", "app_open"),
    row("2026-10-20T09:01:00Z", "b", "import", { kind: "photo", count: 2 }),
    row("2026-10-20T09:02:00Z", "b", "sort_done", { books: 1, classes: 0, others: 0, categories: "Reading" }),
  ];

  it("counts uploads by kind and file type", () => {
    const u = uploads(rows, NOW, 30);
    expect(u.pagesAdded).toBe(7);
    expect(u.byKind).toEqual({ files: 1, photo: 1 });
    expect(u.fileTypes).toEqual({ image: 3, pdf: 2 });
    expect(u.duplicates).toBe(1);
  });

  it("counts sorting by type and category", () => {
    const s = sorting(rows, NOW, 30);
    expect(s.projectsByCategory).toEqual({ Biology: 1 });
    expect(s.categoriesSuggested).toEqual({ Reading: 1 });
    expect(s.shareFiled).toBe(0.57);
  });

  it("builds weekly install cohorts", () => {
    expect(weekOf("2026-10-21T12:00:00Z")).toBe("2026-10-19");
    expect(funnel(rows, [{ user_id: "u1", status: "comp" }], NOW, 4)).toEqual([
      { week: "2026-10-12", installs: 1, importedPct: 100, projectPct: 100, studiedPct: 100, signedUpPct: 100, plusPct: 100 },
      { week: "2026-10-19", installs: 1, importedPct: 100, projectPct: 0, studiedPct: 0, signedUpPct: 0, plusPct: 0 },
    ]);
  });

  it("gives an overview", () => {
    const o = overview(rows, [{ id: "u1", created_at: "2026-10-13T10:09:00Z" }], [{ user_id: "u1", status: "comp" }], NOW, 7);
    expect(o.activeInstalls.total).toBe(1);
    expect(o.accounts).toEqual({ total: 1, new: 0 });
    expect(o.plus).toEqual({ comp: 1 });
  });
});

// Picture cards (spec 11.2): photos, whiteboards and diagrams recalled from the image itself.
import type { BuildResult, LessonDraft, PictureDraft } from "./builder";
import { cosine, tfidf } from "./tfidf";
import { tokens, truncate, wordCount } from "./text";
import type { Card, PageKind } from "./types";

export type PicturePage = { id: string; text: string; heading?: string; kind?: PageKind; image?: string };

export const PICTURES_PER_LESSON = 12;
export const PICTURES_LESSON = "Pictures";
export const MAX_PICTURES_PER_SESSION = 3;

export const isPicture = (c: Card) => c.kind === "picture";

/** Photos, and screenshots with little text (a diagram in a book). */
export function isPicturePage(p: PicturePage): boolean {
  if (!p.image) return false;
  if (p.kind === "photo") return true;
  return p.kind === "screenshot" && wordCount(p.text) < 40;
}

export function pictureDraft(p: PicturePage): PictureDraft | null {
  const body = p.text.trim() || p.heading?.trim() || "";
  if (!body) return null;
  const heading = p.heading?.trim();
  return { pageId: p.id, statement: truncate(body, 280), question: heading ? `What's on this page about ${heading}?` : "What does this page show?" };
}

const stems = (s: string) => tokens(s).map((t) => t.stem);

/**
 * One picture card per picture page. It joins the lesson that already has cards from its page,
 * else the lesson closest by TF-IDF cosine, else a "Pictures" lesson. Max 12 per lesson.
 */
export function withPictures(result: BuildResult, pages: PicturePage[]): BuildResult {
  const picked = pages.filter(isPicturePage);
  const drafts = picked.map(pictureDraft).filter((d): d is PictureDraft => !!d);
  if (!drafts.length) return result;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const lessons: LessonDraft[] = result.lessons.map((l) => ({ ...l, pictures: [...(l.pictures ?? [])] }));
  const docs = [
    ...lessons.map((l) => l.cards.flatMap((c) => stems(c.statement))),
    ...drafts.map((d) => {
      const p = byId.get(d.pageId)!;
      return stems([p.heading ?? "", p.text].join("\n"));
    }),
  ];
  const { vecs } = tfidf(docs);
  const extra: LessonDraft[] = [];
  drafts.forEach((d, i) => {
    let target = lessons.findIndex((l) => l.cards.some((c) => c.pageId === d.pageId));
    if (target < 0) {
      let best = 0;
      lessons.forEach((_, li) => {
        const c = cosine(vecs[lessons.length + i], vecs[li]);
        if (c > best) [best, target] = [c, li];
      });
    }
    if (target >= 0 && lessons[target].pictures!.length < PICTURES_PER_LESSON) {
      lessons[target].pictures!.push(d);
      return;
    }
    let last = extra[extra.length - 1];
    if (!last || last.pictures!.length >= PICTURES_PER_LESSON) {
      last = {
        title: extra.length ? `${PICTURES_LESSON} ${extra.length + 1}` : PICTURES_LESSON,
        summary: "The photos and diagrams you saved.",
        cards: [],
        pictures: [],
      };
      extra.push(last);
    }
    last.pictures!.push(d);
  });
  return { ...result, lessons: [...lessons, ...extra] };
}

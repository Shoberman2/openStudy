import { describe, expect, it } from "vitest";
import { WEAK_TITLE_WORDS, buildOffline } from "./builder";

// The same Seneca and Thoreau text used for the OCR browser test screenshots.
const SENECA = [
  "It is not that we have a short time to live, but that we waste a lot of it. Life is long enough, and a sufficiently generous amount has been given to us for the highest achievements if it were all well invested. But when it is wasted in heedless luxury and spent on no good activity, we are forced at last by death's final constraint to realize that it has passed away before we knew it was passing. So it is: we are not given a short life but we make it short, and we are not ill-supplied but wasteful of it. Just as when ample and princely wealth falls to a bad owner it is squandered in a moment, but wealth however modest, if entrusted to a good custodian, increases with use, so our lifetime extends amply if you manage it properly.",
  "People are frugal in guarding their personal property; but as soon as it comes to squandering time they are most wasteful of the one thing in which it is right to be stingy. Nothing is more certain than that the busy man is least occupied with living. There is nothing which is harder to learn. Learning how to live takes a whole life, and, which may surprise you more, it takes a whole life to learn how to die. Putting things off is the biggest waste of life: it snatches away each day as it comes, and denies us the present by promising the future. The greatest obstacle to living is expectancy, which hangs upon tomorrow and loses today.",
  "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary. I wanted to live deep and suck out all the marrow of life. Our life is frittered away by detail. An honest man has hardly need to count more than his ten fingers. Simplicity, simplicity, simplicity! I say, let your affairs be as two or three, and not a hundred or a thousand.",
];

describe("offline lesson titles", () => {
  it("prefers a repeated adjacent two-word phrase", () => {
    const pages = [
      { id: "a", text: "Guard your personal property as carefully as your hours each and every morning. Thieves rarely take personal property from people who keep careful lists of what they own." },
      { id: "b", text: "Wasted time never returns to anyone who spends it carelessly on trivial errands. Count your wasted time honestly at the end of every single working week." },
    ];
    const r = buildOffline({ title: "Test" }, pages);
    expect(r.lessons).toHaveLength(1);
    expect(["Personal Property", "Wasted Time"]).toContain(r.lessons[0].title);
  });

  it("demotes weak words for the Seneca text and stays deterministic", () => {
    const pages = SENECA.map((text, i) => ({ id: `p${i}`, text, header: i < 2 ? "On the Shortness of Life" : "Walden" }));
    const r1 = buildOffline({ title: "On the Shortness of Life" }, pages);
    const r2 = buildOffline({ title: "On the Shortness of Life" }, pages);
    const titles = r1.lessons.map((l) => l.title);
    expect(titles).toEqual(r2.lessons.map((l) => l.title));
    expect(titles).not.toContain("Short & Time");
    expect(titles).not.toContain("Learn & Life");
    for (const t of titles) {
      const parts = t.toLowerCase().split(/ & | /);
      expect(parts.every((w) => WEAK_TITLE_WORDS.has(w))).toBe(false);
    }
    // Exact output pinned so other clients (iOS) can check parity with the same input.
    expect(titles).toEqual(["Waste & Deep", "Detail & Frittered"]);
  });
});

# OpenStudy Shelf: product + engineering spec (shared by web and iOS)

OpenStudy turns saved book pages (Apple Books screenshots, Notes app excerpts) into a
Duolingo-style study path. Both clients (web in `web/`, iOS in `ios/`) implement the SAME
concepts, data format, engine rules and design system described here. If the spec and your
instinct disagree, follow the spec.

## 1. Concepts

- **Library**: everything the user has. Stored locally on the device (web: IndexedDB, iOS: JSON in Application Support + image files).
- **Page**: one source item. A screenshot (OCR'd text + thumbnail) or a Notes excerpt (text).
- **Inbox / Sort**: newly imported pages land here grouped into *suggested projects*. The user confirms, renames, merges, or reassigns before they become real projects. This is the "sorting" feature for thousands of pages.
- **Project**: one book (or one notes source). Title, author, color.
- **Lesson**: a theme inside a project ("Being Liked"). Has a level 0..5 (like Duolingo crowns).
- **Quotes lesson**: special lesson (kind `quotes`) for learning exact wording. Only created after asking the user (see 6.3).
- **Card**: one fact or one quote. Exercises are generated from cards at runtime based on lesson level and user preferences.

## 2. Data format (Library v1, JSON, identical on both platforms; used for export/import sync)

```ts
type Library = {
  version: 1;
  profile: {
    onboarded: boolean;
    bringing: "screenshots" | "notes" | "both";
    goals: Array<"ideas" | "facts" | "quotes" | "apply">;
    practice: Array<"tap" | "blank" | "type" | "flash">;
    dailyGoalXP: 10 | 20 | 30 | 50;
    reminder?: string;            // "HH:mm" local
  };
  stats: {
    xp: number; streak: number; longestStreak: number;
    lastActiveDay?: string;       // "YYYY-MM-DD" local
    freezes: number;              // streak freezes, max 2
    dayXP: Record<string, number>; // "YYYY-MM-DD" -> xp earned that day
  };
  projects: Project[]; pages: Page[]; lessons: Lesson[]; cards: Card[];
  events: Array<{ t: string; name: string; props?: Record<string, string | number | boolean> }>;
};
type Project = { id: string; title: string; author?: string; color: ProjectColor; createdAt: string;
  focus: "ideas" | "ideas+quotes"; quotesAsked: boolean; sample?: boolean };
type ProjectColor = "blue" | "red" | "yellow" | "green" | "ink";
type Page = { id: string; projectId: string | null; kind: "screenshot" | "note";
  text: string; header?: string; suggestedTitle?: string; suggestedAuthor?: string;
  image?: string;  // web: IndexedDB blob key; iOS: file name. Not exported.
  assetId?: string; // iOS PHAsset localIdentifier, to skip re-imports
  createdAt: string };
type Lesson = { id: string; projectId: string; title: string; summary: string;
  kind: "theme" | "quotes"; order: number; level: number /*0..5*/; sessions: number };
type Card = { id: string; lessonId: string; projectId: string; pageId?: string;
  kind: "fact" | "quote";
  statement: string;              // fact: full sentence. quote: the exact quote text
  cloze?: string;                 // fact: key term inside statement (exact substring)
  question?: string;              // fact: direct recall question
  answer?: string;                // fact: short answer to question (1-6 words)
  distractors?: string[];         // 3 wrong-but-plausible short answers
  falseStatement?: string;        // fact: statement with one detail changed to be false
  attribution?: string;           // quote: "Dale Carnegie"
  srs: Srs };
type Srs = { state: "new" | "learning" | "review"; ease: number; interval: number /*days*/;
  due: string /*ISO*/; reps: number; lapses: number };
```

New cards: `{state:"new", ease:2.5, interval:0, due:<now>, reps:0, lapses:0}`.
IDs: random 10 char base36. Project colors cycle blue, red, yellow, green, ink.

`shared/sample-library.json` contains two demo projects (cards without `srs`; initialize on load).
Offer "Try a sample book" in onboarding and use it for the landing page demo.

## 3. Import

### 3.1 Screenshots
- OCR on device. iOS: Vision `VNRecognizeTextRequest` (.accurate, language correction on). Web: tesseract.js (lazy loaded, worker, eng) with a visible queue + progress; concurrency 2.
- Keep observation geometry: lines whose box top is in the top 9% of the image are **header candidates**; lines in the bottom 7% are footer (page numbers, "12 of 280", "5 pages left in chapter") and are dropped.
- Drop iOS status bar noise: lines matching time (`^\d{1,2}:\d{2}`), `%$`, carrier/LTE/5G tokens, lines < 3 chars.
- Clean body: join hyphenated line breaks (`exam-\nple` -> `example`), join wrapped lines into paragraphs, collapse whitespace.
- Skip non-book screenshots: body < 40 words or < 60% of tokens are alphabetic words. Report "N skipped (not book pages)".
- iOS: also offer "Scan my Screenshots album": PhotoKit read access, fetch `mediaSubtypes` containing `.photoScreenshot`, skip assets whose `localIdentifier` is already in the library, process in batches of 20 with progress and cancel. Plus a normal PhotosPicker (filter `.screenshots`, unlimited selection).
- Web: drag and drop / file input, multiple images, any count. Store a compressed thumbnail (max 900px, JPEG 0.72) in IndexedDB.

### 3.2 Notes app text
When you copy from Apple Books and paste into Notes, Books appends this footer. Parse it; it gives exact book grouping and verbatim quotes:
```
<excerpt text>

Excerpt From
<Book Title>
<Author>
This material may be protected by copyright.
```
- A pasted blob can contain many excerpts. Split on the footer. Each excerpt -> Page(kind "note", suggestedTitle, suggestedAuthor). Excerpts are verbatim, so they are strong quote candidates.
- Text without the footer: split into paragraphs; each paragraph/bullet becomes a page; the first line if short (< 60 chars, no period) is used as suggestedTitle.
- Inputs: paste box (web + iOS "Paste from Notes" reading the clipboard), `.txt` / `.md` / `.html` files (strip tags).

### 3.3 Grouping into suggested projects (offline)
1. Use `suggestedTitle` when present.
2. Else group by normalized header (lowercase, strip digits/punctuation). Apple Books shows the book title or the chapter title in the header. Headers that appear on fewer than 2 pages join the group whose body TF-IDF centroid is closest (cosine > 0.12) else "Unsorted".
3. Show groups on the Sort screen: editable title + author, page thumbnails/snippets, actions: Create project, Merge into existing project (picker), Move page, Discard page. Also "Add all to <existing project>" when a title matches an existing project (case-insensitive).

### 3.4 Smart organize (Claude, optional)
Web exposes `GET /api/health -> {ai: boolean}` and two POST routes, both returning HTTP 503 `{error:"no_ai"}` when `ANTHROPIC_API_KEY` is not set. Clients then fall back to the offline engine silently (Settings shows "Smart organize: off").
- `POST /api/sort` `{pages:[{id, header?, text /*first 700 chars*/}]}` -> `{groups:[{title, author?, pageIds}]}`
- `POST /api/build` `{project:{title, author?}, pages:[{id,text}], profile, wantQuotes:boolean}` ->
  `{lessons:[{title, summary, cards:[{pageId?, statement, cloze, question, answer, distractors, falseStatement}]}], quotes:[{pageId?, text, attribution?}]}`
- Implementation: `@anthropic-ai/sdk`, model `claude-opus-5-5`, `output_config: {effort: "low", format: <json schema>}` (structured outputs), `betas:["server-side-fallback-2026-07-01"]` + `fallbacks:"default"` via `client.beta.messages`. Check `stop_reason === "refusal"`. Chunk large projects (max ~60 pages per call) and merge lessons by title.
- iOS Settings has "Smart organize server" (URL of the deployed web app). Empty = offline only. iOS calls the same routes.

## 4. Offline lesson builder (deterministic; both platforms must implement)
Input: the project's pages. Output: theme lessons + fact cards + quote candidates.
1. **Sentences**: split body text into sentences (`.?!` followed by space + capital, keep abbreviations like "Mr." "Dr." "e.g."). Keep sentences of 7..45 words. Dedupe (normalized).
2. **Tokens**: lowercase words, strip punctuation, drop stopwords (use a standard ~180 word English list) and words < 3 chars. Light stemming: strip trailing `s`, `es`, `ing`, `ed` when the remainder is >= 4 chars.
3. **TF-IDF** over sentences within the project.
4. **Themes**: if >= 2 distinct header values each covering >= 3 sentences (chapter titles), group by header. Otherwise k-means (cosine) with `k = clamp(round(sqrt(n/5)), 1, 6)`, deterministic farthest-first init starting from the sentence with the highest TF-IDF norm, 12 iterations. Drop clusters with < 3 sentences into the nearest cluster.
5. **Lesson title**: chapter header (Title Case) if grouped by header (headers equal to the project title, normalized, are ignored: they are the book title, not a chapter). Otherwise, deterministically:
   - **Weak title words** (demoted, never banned): short, long, great, good, many, much, make, take, life, time, thing, things, way, people, person, learn, know, every, first, little, own, whole, day, new, old, big, small, come, give, find, need, want, work, year, years, man, men, part, place, right, live, living, lived, nothing, something, anything, everything, hard, harder, easy, best, better, less, high, highest, same, other, able, use, used, say, see, keep, put, get, seem, look, tell, call, mean, become, went, came, wish, wished, one, two, three, lot, lots, kind, sort, bit, given, gave, made, taken, done, said. A word is weak if it or its stem is in the list.
   - **a. Repeated phrase**: over the cluster's sentences, take adjacent lowercase word pairs (strip a trailing `'s`) where neither word is a stopword, both are >= 3 letters, neither contains a digit, and not both are weak. Count the number of distinct sentences containing each pair. If any pair has count >= 2, the title is the pair with the highest count (ties: higher sum of the two words' stem weights in the cluster centroid, then earliest occurrence), in Title Case, e.g. "Personal Property", "Wasted Time".
   - **b. Terms**: else score every centroid stem as weight x (0.35 if weak else 1), sort by score desc (ties: surface form alphabetical), map to the most common surface form, and take the top 2 as `"Term & Term"` in Title Case. Skip a second term that shares its first 4 letters (case-insensitive) with the first ("Waste & Wasteful").
   - In both branches skip a candidate whose title is already used by another lesson in the project; fallback "Key Ideas". Duplicate titles that remain get " 2", " 3" appended.
   - Parity check: the Seneca/Thoreau test text in `web/src/engine/titles.test.ts` must produce `["Waste & Deep", "Detail & Frittered"]`.
   Summary: the sentence closest to the centroid, truncated to 120 chars.
6. **Fact cards** (max 14 per lesson, prefer highest TF-IDF-sum sentences): `statement` = sentence; `cloze` = the highest weight non-stopword token (surface form, >= 4 chars) in it; `answer` = cloze; `question` = statement with cloze replaced by "____" (fact cards offline have no separate question); `distractors` = 3 cloze answers from other cards in the project with similar length (fallback: high-weight project terms); `falseStatement` = statement with cloze swapped for the first distractor.
7. **Quote candidates**: excerpts from Notes footer (3.2) <= 60 words; text inside quotation marks 6..50 words; sentences 6..30 words that start with an imperative verb (list: be, do, don't, never, always, remember, give, make, let, try, talk, ask, begin, avoid, show, become, smile, listen, think, keep, treat, choose, act) or contain aphorism markers ("the only way", "is the", "most people", "you can"). Max 20 per project.

## 5. Study engine

### 5.1 Exercise types
- `mc`: show `question` (cloze blanked statement or direct question); 4 options = answer + 3 distractors, shuffled.
- `tf`: show `statement` or `falseStatement` (50/50); True / False.
- `bank`: cloze with a word bank (answer + distractors + 2 extra words from statement), tap to fill.
- `type`: type the answer to `question`. Checking in 5.3.
- `match`: 4 pairs (cloze term <-> its blanked statement truncated to 70 chars), tap to pair. Uses 4 cards, counts as one exercise.
- `flash`: show question, tap to reveal, self grade (Again / Hard / Good / Easy). Only if user picked "flash".
- `apply`: elaboration prompt "How would you use this?" + statement; free text, any non-empty answer of >= 4 words passes; awards +3 XP. Only if goals include "apply". Max 1 per session.
- Quotes: `q-bank1` (1 blank, word bank), `q-bank3` (3 blanks, word bank), `q-order` (quote split into 3..5 chunks at punctuation/~6 words, tap in order), `q-letters` (show first letter of each word, e.g. "A__ f___ c__ c________", type full quote), `q-recall` (type full quote with attribution shown). Blanks prefer longest non-stopword words.

### 5.2 Session builder `buildSession(lesson, cards, profile, now)`
- Length: 10 exercises for theme lessons, 8 for quotes.
- Card pick: due cards first (srs.due <= now, oldest first), then new cards, then least-recently-seen. Each card at most twice.
- Theme lesson mix by `level` (0 means first time):
  - level 0: mc, tf, match, bank
  - level 1: mc, bank, tf
  - level 2: bank, type, mc
  - level 3: type, bank, tf
  - level 4+: type, type, mc, apply
  Weighting from preferences: types matching `profile.practice` get weight 2, others 1 (tap -> mc/tf/match, blank -> bank, type -> type, flash -> flash replaces one slot when picked). Never two `match` in a row; first exercise of a session is never `type`.
- Quotes lesson by level: 0: q-bank1; 1: q-bank1, q-bank3; 2: q-bank3, q-order; 3: q-order, q-letters; 4+: q-letters, q-recall.
- **Mistakes are re-queued** at the end of the session (Duolingo style); the session ends only when every exercise has been answered correctly once. Progress bar = correct / total.
- Finishing a session: `lesson.sessions += 1`, `lesson.level = min(5, level + 1)`.
- **Practice (review)**: Home has "Practice" that builds an interleaved 12 exercise session from due cards across ALL projects (mix of mc/bank/type for facts, q-bank3/q-letters for quotes). Empty state: "Nothing due. Your next review is <relative time>."

### 5.3 Answer checking
normalize = lowercase, strip punctuation, collapse spaces, drop leading "the/a/an". Correct if equal; "close" (counts correct, grade Hard, show "Watch the spelling: <answer>") if Levenshtein <= max(1, floor(len*0.15)). Quote recall: word-level LCS ratio vs target >= 0.9 correct, 0.75..0.9 close, else wrong; show a word diff (missing words in red, extra struck).

### 5.4 SRS (SM-2 variant). grade in {again, hard, good, easy}
- again: if reps>0 lapses+=1; reps=0; interval=0; ease=max(1.3, ease-0.2); state="learning"; due=now+10 minutes.
- else: reps+=1; interval = reps==1 ? 1 : reps==2 ? 3 : round(interval*ease*(hard?0.8: easy?1.3: 1)); ease += hard? -0.15 : easy? +0.15 : 0; clamp ease to [1.3, 3.0]; state="review"; due = local start of today + interval days.
- Mapping: wrong -> again; close or flash Hard -> hard; correct -> good; correct `type`/`q-recall` answered in < 6s, or flash Easy -> easy. Grade a card once per session (first attempt).

### 5.5 XP, streak, goal
- +1 XP per correct first attempt, +10 per completed lesson session, +5 bonus if no mistakes, +3 per apply. Combo counter shown at 3+ correct in a row.
- Streak: on the first XP of a local day: if lastActiveDay == yesterday -> streak+1; if == today -> no change; if older: use a freeze if freezes>0 for a 1 day gap, else streak=1. Every 7th streak day grants a freeze (max 2). longestStreak tracks max.
- Daily goal ring = dayXP[today] / dailyGoalXP.

### 5.6 Instrumentation (validated learning)
Append to `library.events`: `onboarding_done {goal, practice}`, `import {kind, count, skipped}`, `project_created {pages, lessons}`, `quotes_answer {yes}`, `session_start {lessonKind, level}`, `session_done {accuracy, seconds, xp}`, `review_done {count}`. Settings shows "Your week": days active (last 7), sessions, accuracy, cards due. Keep it to that.

## 6. Flows and screens

### 6.1 Landing (web `/`; iOS welcome screen before onboarding)
One quick statement, then the actual product behind it. No numbered steps, no feature grid of icons, no testimonials, no fake stats.
- Headline: **"Your book screenshots, turned into lessons."**
- Sub: "Drop in the pages you saved from Apple Books or Notes. OpenStudy sorts them by book, finds the themes, and drills you until they stick."
- CTAs (equal weight): "Start studying" (web app) and "Get the iPhone app".
- Behind/under the headline on web: the real, working app UI (not an image): a live exercise from the sample library the visitor can answer right there, next to an iPhone frame with a real screenshot of the iOS app (`web/public/ios-*.png`, captured from the simulator).
- Below: a single strip that shows the real pipeline with real components: a page (rendered like an Apple Books page) -> its project on the shelf -> the lesson path. Then a live quotes exercise ("Quotes, word for word"). Then a closing CTA. That's it.
- iOS welcome: same headline + sub, the app's real lesson path visible behind it (rendered from sample data, dimmed/blurred lightly), buttons "Get started" and "I have a library file".

### 6.2 Onboarding (both). One question per screen, progress bar on top, chunky option tiles, Continue.
1. "What are you bringing?" Book screenshots / Notes from the Notes app / Both
2. "What do you want from your reading?" (multi) Remember the big ideas / Know the facts cold / Quote it word for word / Use it in real life
3. "How do you like to practice?" (multi) Quick taps / Fill in the blank / Type it from memory / Flashcards
4. "Pick a daily goal" Casual 5 min (10 XP) / Regular 10 min (20 XP) / Serious 15 min (30 XP) / Intense 20 min (50 XP)
5. iOS only: "When should we nudge you?" time picker + Allow notifications (local daily notification) / Not now.
6. "Add your first book": Import screenshots / Paste notes / Try a sample book.

### 6.3 Project creation (after Sort)
Ask, per project: "How do you want to study <Title>?" Big ideas / Ideas and exact quotes.
If quote candidates exist ask: "We found <N> lines that read like quotes. Want a Quotes lesson so you learn the exact wording?" Yes, make it / No, just the ideas. (If they chose "Ideas and exact quotes" and N>0, preselect Yes but still show the list so they can untick lines.) Also allow "Mark as quote" on any page later (Project > Pages).

### 6.4 App screens
- **Home**: streak flame + count, XP, daily goal ring; big "Continue" (next unfinished lesson of most recent project); "Practice" (due count); the **Shelf**: projects shown as book spines (colored vertical spines with the title set vertically, author small), plus a "+" spine to import. Inbox badge when pages await sorting.
- **Project**: header (title, author, pages count), the **path**: vertical zigzag of round nodes (one per lesson, ordered), filled ring segments show level 0..5, locked nodes grey (a theme lesson unlocks when the previous has level >= 1; the quotes node is always unlocked and sits after the first lesson, with a quotation mark glyph). Current node has a "Start" tag above it. Tap node -> sheet with title, summary, level, "Start" button. Tabs: Path / Pages (source pages with thumbnails/text, mark as quote, move, delete).
- **Session**: top bar (close X, progress bar, combo flame), prompt area, answer area, bottom "Check" button. Feedback panel slides up: green "Correct" or red "Not quite" + correct answer + source line "From <Book>" with a tap to see the page. Continue. End screen: XP earned, accuracy, time, streak, Continue.
- **Import / Sort** as in section 3.
- **Settings**: study preferences (re-run onboarding answers inline), daily goal, reminder (iOS), Smart organize status/server URL, Export library (JSON file), Import library (merge by id), Reset, Your week stats.

## 7. Design system: minimal, base colors, chunky and friendly

Tokens (light / dark):
- `--paper` #FFFFFF / #101012  (page background)
- `--shelf` #F4F3EF / #18181B  (subtle sections, input fill)
- `--ink` #141414 / #F3F3F3  (text, borders when strong)
- `--muted` #6E6E6E / #A0A0A6
- `--line` #E5E4DF / #2A2A2E
- `--blue` #2F5BEA (primary action, progress)  shadow #1F43B8
- `--red` #E8423A (wrong, hearts)              shadow #B32D27
- `--yellow` #FFC531 (XP, streak, goal)         shadow #D49B10  (text on yellow is ink)
- `--green` #1FA35B (correct)                  shadow #167A43
- Project "ink" color uses `--ink` with paper text.

Type: rounded sans everywhere for UI. Web: `ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif` (load Nunito 400/700/800/900 via next/font as fallback). iOS: `.rounded` design system font. Quotes and book page text use a serif (web "Newsreader" via next/font; iOS `.serif` design = New York). Sizes: display 44/48 web (34 iOS), title 24, body 17, small 14. Weight 800 for headings, 700 for buttons. Tight letter spacing on display (-0.02em).

Components:
- Buttons: radius 16, height 52, no border, solid fill, bottom "lip" shadow `0 4px 0 <shadow color>`; pressed = translateY(4px) + shadow 0. Uppercase NOT used. Primary blue/white text. Secondary: paper fill, 2px `--line` border, lip in `--line`.
- Option tiles: 2px `--line` border, radius 14, lip 0 3px 0 `--line`; selected = blue border + light blue fill (#EAF0FF / dark #1B2550) + blue lip.
- Progress bar: 14px tall, `--shelf` track, fill in green for sessions, blue elsewhere, with a lighter 4px highlight stripe inside the top of the fill.
- Path nodes: 72px circles, lip 0 6px 0 darker shade, level ring around the node (5 segments). Zigzag offsets: 0, +60, +90, +60, 0, -60, -90, -60 px.
- Book spine: 64x220 (web), rounded 6, colored fill, title vertical (writing-mode vertical-rl / rotated text on iOS), small author at the bottom, a thin lighter band near top and bottom like real spines.
- Feedback panel: full width, light green (#E6F7EE / dark #10301F) or light red (#FDECEB / dark #3A1513) with matching colored text, chunky Continue button in green/red.
- Icons: simple line icons (web: lucide-react; iOS: SF Symbols). No emoji in UI chrome. The streak uses a flame icon in yellow.
- Motion: quick and physical: 120-180ms ease-out; button press; correct answer = small pop (scale 1.04) and haptic (iOS `.success`); wrong = horizontal shake + haptic `.error`; lesson complete = XP counter rolls up and the ring fills. Respect reduced motion.

Hard rules (no "AI slop"): no gradients, no glassmorphism, no glowing blobs, no decorative emoji, no "01 / 02 / 03" step labels, no generic hero illustrations, no stock phrases ("Unlock your potential", "Supercharge", "Seamless"), no fake testimonials or user counts, NO em dashes anywhere in copy (use colons, commas, parentheses). Copy is short, plain, second person. Every screen should be understandable in 3 seconds.

## 8. v2: any material, class notes, study plans (OVERRIDES earlier sections where they conflict)

OpenStudy is no longer only for books. Anything a student or reader wants to learn must work: Apple Books screenshots, Notes excerpts, photos of a whiteboard or handwritten notes, PDFs (typed or scanned), PowerPoint/Keynote exports (.pptx), Word docs (.docx), plain text/markdown/html. A project can be a book, a class, or anything else.

### 8.1 Data model additions (still `version: 1`; all new fields optional so old files load)
- `Project.type?: "book" | "class" | "other"` (default "book" for old data). `Project.goalDate?: "YYYY-MM-DD"` (exam or finish-by date). `Project.minutesPerDay?: number` (override of the daily goal for this project's plan).
- `Page.kind` adds `"photo" | "pdf" | "slides" | "doc"` (existing `"screenshot" | "note"` stay). `Page.sourceName?: string` (original file name), `Page.sourceIndex?: number` (1-based page or slide number), `Page.heading?: string` (slide title or nearest section heading), `Page.verbatim?: boolean` (text is an exact excerpt, e.g. Books "Excerpt From" notes).
- `Card.term?: string`, `Card.definition?: string` for definition cards (`kind: "fact"`, `statement` = "Term: definition").
- `profile.bringing` becomes `Array<"books" | "class" | "anything">` (accept the old string values when loading: "screenshots"/"notes"/"both" -> ["books"]).
- `Page.sourceTitle?: string` (PDF/PPTX/DOCX metadata title of the source file; used by 8.3 step 3 and 8.4 lesson titles; generator junk like "about:blank", URLs, file names and "Microsoft Word - ..." is ignored). `profile.pendingGoalDate?: "YYYY-MM-DD"` (exam date answered in onboarding; applied to the first class project created, then cleared).

### 8.2 Import: every format
One import screen, one drop zone / picker: "Drop anything: screenshots, photos of notes or a whiteboard, PDFs, slides, docs." Each file becomes one or more Pages; pages from one file always stay together.
- Images (any photo, screenshot, whiteboard): OCR. Web: tesseract.js. iOS: Vision `.accurate` (handles handwriting well). When Smart organize is available, images are read with Claude vision instead via `POST /api/read` (`{image: base64 jpeg max 1600px, mediaType}` -> `{text, heading?}`), because it reads handwriting and diagrams far better; fall back to local OCR on any failure. Book-page header/footer rules (3.1) apply only to screenshots that look like Apple Books pages (portrait, phone aspect). Photos are never skipped as "not a book page"; skip only if OCR returns < 5 words, and say "N had no readable text".
- iOS extra: "Scan notes or a whiteboard" using VisionKit `VNDocumentCameraViewController` (perspective corrected), plus camera/photo library pick of any photo (not only screenshots).
- PDF: web `pdfjs-dist` (worker), iOS `PDFKit`. Per page: extract text; if a page yields < 20 characters, render it (2x) and OCR it (scanned PDF). `heading` = first short line (< 80 chars, no ending period) or the largest-font line when available. Title suggestion: PDF metadata title, else cleaned file name.
- PPTX: it is a zip. Read `ppt/slides/slideN.xml` in numeric order, collect `<a:t>` runs per paragraph (`<a:p>`); the title placeholder (`<p:ph type="title"/"ctrTitle">`) text becomes `heading`; also append speaker notes from `ppt/notesSlides/notesSlideN.xml` (skip slide-number placeholders). One Page per slide (skip slides with < 3 words). Web: JSZip. iOS: implement a small ZIP reader (central directory + local headers; methods 0 stored and 8 deflate via the Compression framework's raw `COMPRESSION_ZLIB`), no third-party deps. Keynote/Google Slides users export to .pptx or .pdf; say so in the picker hint.
- DOCX: zip, `word/document.xml`; paragraphs from `<w:p>`/`<w:t>`; paragraphs with style `Heading1..3`/`Title` become `heading` boundaries. One Page per heading section (or per ~250 words if no headings).
- TXT/MD/HTML: markdown `#` headings are heading boundaries; html strip tags, `<h1-3>` are headings. Books "Excerpt From" parsing (3.2) still applies to any pasted/plain text.
- Report after import: "Added 42 pages from 3 files. 2 had no readable text."

### 8.3 Grouping (replaces 3.3 where they differ)
1. `suggestedTitle` first (Books footer, user edits).
2. Course detection: a course code (`\b[A-Z]{2,5}\s?-?\d{2,4}[A-Z]?\b`, e.g. "BIO 101", "CS229") found on a file's first 2 pages groups all files with the same code into one project titled by the code plus the most common following words, type "class".
3. Each non-screenshot file is a unit: its suggested project title is PDF/PPTX metadata title, else first-page heading, else cleaned file name (drop extension, "lecture/week/lec/slides/notes" + numbers, underscores). Files whose titles share >= 50% of non-stopword tokens merge.
4. Screenshots and photos without a file unit use the header rule (3.3) / text similarity; whiteboard photos taken within 3 hours of each other join the same pile.
5. Project type guess: "book" if Books screenshots/excerpts, "class" if course code, slides, or lecture-like file names, else "other". Editable on Sort and in project settings.

### 8.4 Lessons for class material (extends section 4)
- If a project has >= 2 source files (lectures/decks/PDFs), each file is one lesson in file order (sort by any number in the file name, else import order), titled by the file's title (e.g. "Lecture 4: Enzymes" -> "Enzymes"). A file with > 30 sentences is split by its headings into sub-lessons "Enzymes: Kinetics".
- If one file, lessons follow its headings (slide titles / doc headings), merging consecutive slides with the same title and merging sections < 3 sentences into the previous; fallback k-means (section 4).
- Slides and notes are bullet-heavy: treat each bullet/line of >= 4 words as a sentence even without a period.
- **Definition cards** (highest priority card type for class material): detect lines like `Term: definition`, `Term - definition`, `Term = definition`, `Term is/are/means/refers to definition`, `Term (abbr) is ...` where Term is 1..5 words and the definition 4..40 words. Card: term, definition, statement "Term: definition", question "What is Term?", answer = Term for reverse prompts, distractors = 3 other terms in the project. Up to 20 per lesson, then cloze facts fill the rest (max 24 cards per lesson total).
- Quotes lesson question (6.3) is asked only for type "book" (or when verbatim excerpts exist).

### 8.5 New exercise types
- `def-mc`: show term, pick the right definition from 4 (distractor definitions from other definition cards).
- `term-type`: show definition, type the term (answer checking 5.3).
- `match` prefers term <-> definition pairs when available.
- `explain` (Feynman): "Explain <term or lesson title> in your own words like you're teaching a friend." Free text >= 12 words passes, then show the source statement(s) to compare and self rate (Got it / Partly / Missed it -> good / hard / again). Replaces `apply` for class projects at level >= 3.
- Mix for class lessons by level: 0: def-mc, mc, match; 1: def-mc, bank, tf; 2: term-type, bank, mc; 3: term-type, type, explain; 4+: term-type, type, mc, explain. Book projects keep 5.2.

### 8.6 Study plan (new: core feature)
Built on spacing, retrieval practice, interleaving and practice testing. Deterministic and recomputed from current state every time it is shown (only completions are stored, via events).
- Inputs: all projects, each with optional `goalDate` and `minutesPerDay`; profile daily goal minutes (10 XP=5, 20=10, 30=15, 50=20 min). Session cost estimate: theme/class lesson 4 min, quotes 3 min, practice test 8 min, due review 0.3 min per card.
- A lesson is "ready" at level >= 3 and "mastered" at 5.
- Each day from today until the latest goalDate (or 7 days when no goal):
  1. Reviews first: cards due that day (projected by SRS from current state), capped at 40% of the day's minutes; overflow rolls to the next day.
  2. Practice tests for a project with a goalDate on goal-1 day, goal-3 day, and goal-7 day (when the window allows).
  3. New learning and strengthening, interleaved round robin across projects (weight 2 for projects with a goalDate in the next 14 days): pick the next lesson that is not ready, never the same lesson twice in one day, and leave at least 1 day between sessions of the same lesson (spacing) unless the goal is <= 2 days away. Lessons flagged weak by the last practice test (accuracy < 70%) get priority.
  4. Stop when the day's minutes are used.
- Feasibility: if not every lesson of a project can reach ready by goal-1, show "To be ready for <title> by <date> you need about <N> min a day" with a "Use <N> min" button that sets `minutesPerDay`.
- **Practice test** session: 20 questions (or all cards if fewer) across all of a project's lessons, recall-heavy (type, term-type, tf, mc), no feedback until the end, then score, per-lesson accuracy bars, and "Review your misses" (a normal session from missed cards). Event `test_done {projectId, accuracy, weakLessons}`.
- Screens: Home shows "Today's plan" (the first 3..5 items as tappable rows with minutes, checkmarks when done today) above Continue; a full Plan screen lists the next days grouped by date ("Today", "Tomorrow", "Thu, Oct 22") with exam markers. Project screen gets a "Goal date" control ("Exam or finish-by date") and a practice test button once >= 2 lessons are ready.
- Onboarding Q1 becomes "What are you studying?" (multi): Books I'm reading / Classes / Anything else. Add an optional question when "Classes" is picked: "Got an exam coming up?" date picker / Not yet (applies to the first class project created).

### 8.7 Copy
- Headline: **"Anything you want to learn, turned into lessons."**
- Sub: "Drop in book screenshots, class slides, PDFs, or a photo of the whiteboard. OpenStudy sorts it, builds the lessons, and plans your study days until it sticks."
- The landing pipeline strip shows mixed sources (a book page, a slide, a whiteboard photo rendered as real HTML, not stock images) flowing into projects and a plan. Keep everything else in 6.1 and section 7. Still no em dashes.
- Sample library: add a third sample project of type "class" ("BIO 101: Cell Biology", 2 lectures as lessons, definition cards like "Mitochondria: the organelle that produces most of the cell's ATP", a goalDate 10 days after first load) so the plan, definition exercises and practice test are visible in the demo. It is already in shared/sample-library.json (project id "smpbio101", type "class"). When loading the sample, set its goalDate to local today + 10 days.

## 9. v3: find my notes, categories, organize everything (OVERRIDES earlier sections where they conflict)

Goal: one tap finds the notes a person already has (Photos, Apple Notes) and turns them into categorized projects (books, classes, topics), each with theme lessons (section 4 / 8.4). Platform facts: iOS gives apps NO access to the Notes app, but full Photos access via PhotoKit. macOS can read Notes through AppleScript (JXA). The web app can only read Notes when it runs locally on a Mac.

### 9.1 Data model additions (still `version: 1`, all optional)
- `Project.category?: string` (subject shelf, e.g. "Biology"). Backfilled on load with 9.4 when missing (the sample projects ship with one).
- `Page.folder?: string` (Apple Notes folder). `Page.noteId?: string` (Apple Notes id, or `sc:<hash>` from the Shortcut bridge), used to skip notes already added.
- `SuggestedGroup.category?: string`.
- Device-only, not exported: the set of PhotoKit asset ids already checked by the Photos sweep (iOS `scanned-assets.json` next to `library.json`).

### 9.2 Sources
- **Photos sweep (iOS)**, "Find notes in Photos" (replaces "Scan my Screenshots album"). Read access to the whole library, all images, newest first, skipping asset ids already in the library or in the checked set. Pass 1 (fast detect): request the full-quality image (`.highQualityFormat`, never `.fastFormat`, whose cached thumbnail has no readable text) scaled to 1080px on the long side, `VNRecognizeTextRequest` `.fast`, no language correction; the photo is a candidate when it has >= 25 recognized words. Pass 2: candidates go through normal image ingest (8.2, `.accurate`, Books header rules for screenshots). Every checked id is added to the checked set (saved every 50 photos and at the end), so re-running only looks at new photos and a stopped sweep resumes. Progress text: "Checked 1,240 of 8,000 photos. Found 96 with notes." Event `library_scan {source: "photos", checked, found}`.
- **Apple Notes export format** (shared by the Mac exporter, the local web route and the iOS file import):
  ```ts
  type NotesExport = { openstudyNotes: 1; exportedAt: string;
    notes: Array<{ id: string; title: string; folder?: string; created?: string; modified?: string; html?: string; text?: string }> };
  ```
- **Mac**: `web/scripts/export-notes.mjs` runs JXA via `osascript` and writes `apple-notes.json` (format above). Folders named "Recently Deleted" are skipped. Both apps accept this file in Import files (a `.json` file whose top level has `openstudyNotes: 1`).
- **Web, local only**: `GET /api/notes` runs the same JXA and returns the `NotesExport`. Available only when `process.platform === "darwin"`, `OPENSTUDY_LOCAL_NOTES === "1"` and the request host is `localhost`/`127.0.0.1`/`::1`; otherwise 404 `{error: "unavailable"}`. Off by default: `npm run dev:notes` opts in AND binds the server to 127.0.0.1, because a server listening on all interfaces would let anyone on the network (who can fake the Host header) read the user's notes. Permission denied or timeout (5 min) -> 403 `{error: "permission"}`. `GET /api/health` adds `notes: boolean`. The import screen shows "Bring in Apple Notes" only when `notes` is true. macOS asks once for Automation permission.
- **iPhone Shortcut bridge**: the app registers the URL scheme `openstudy` and handles `openstudy://import-notes` by reading the clipboard. The Shortcut (steps shown in the app) is: Find All Notes, Repeat with Each, Text block
  ```
  === OpenStudy note ===
  Title: <Name>
  Folder: <Folder>
  <Body>
  ```
  , End Repeat, Combine Text with New Lines, Copy to Clipboard, Open URL `openstudy://import-notes`. "Paste from Notes" also accepts this text.
- **Bridge text parsing**: split on lines that are exactly `=== OpenStudy note ===`; within a chunk, optional leading `Title:` and `Folder:` lines; the rest is the body; drop the body's first line if it equals the title. `noteId = "sc:" + fnv1a32hex(title + "\n" + body.slice(0, 200))`.

- Reading speed (iOS): images are read in batches of up to 4 at once (Vision runs each on its own thread) and added in their original order. The progress screen shows the moment photos are picked or the Photos sweep starts, before photo access, library listing or iCloud downloads finish.

### 9.3 Notes to pages
For each note (skip folder "Recently Deleted", skip notes whose `noteId` is already in the library, skip bodies < 8 words):
1. Body text: `text` if present, else `html` stripped (block tags and `<br>` become newlines, `<h1-3>` become `#` headings). The note title is the first non-empty line when `title` is missing; drop the body's first line if it equals the title.
2. If the body contains a Books "Excerpt From" footer, parse it with 3.2 (verbatim excerpts, suggestedTitle/Author from the footer).
3. Else split into sections at `#` headings; each section is split further into pages of about 250 words at paragraph boundaries. A section without a heading uses the note title as `heading` for its first page.
4. Every page: `kind "note"`, `sourceName` = note title, `sourceIndex` = 1-based page index within the note, `folder`, `noteId`, `createdAt` = note created (else now).
Report: "Added 312 pages from 148 notes. 9 were already here." When nothing new was added: "Nothing new. All 9 notes were already here." ("That note was already here." for one).

### 9.4 Categories (deterministic, both platforms; data in `shared/categories.json`)
`categorize(group) -> string`, first rule that applies:
1. **Course code** (8.3) prefix in `coursePrefixes` (e.g. BIO -> Biology).
2. **Folder**: >= 60% of the group's pages share one folder not in `genericFolders` (case-insensitive): that folder name, trimmed, as written.
3. **Lexicon**: tokens (4.2) of the group's title + page texts. Each category's `words` are stemmed with 4.2 at load. `hits` = token occurrences whose stem is in the category, `distinct` = distinct such stems. Eligible when `distinct >= 3` and `hits >= max(4, 0.02 * tokenCount)`. Highest `hits` wins; ties go to the earlier category in the file.
4. **Fallback** by type: book "Reading", class "Classes", other "General".
Smart organize: `POST /api/sort` groups may include `category`; the request includes `categories` (names already on the shelf plus the file's names) so the model reuses them. Missing categories fall back to the offline rule.

### 9.5 Grouping notes into projects (extends 8.3)
1. Note pages with a `noteId` and no `suggestedTitle` are **note units** (pages of one note stay together), titled by the note title cleaned like a file name (8.3.3) plus: strip leading "notes on|notes from|summary of|thoughts on", trailing "notes|summary", and dates (`\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?`). A cleaned title of the form `<Title> by <Author>` (Author = 1..4 capitalized words) gives `title` and `author`, type "book".
2. Course codes (8.3.2) apply to note units too. The course name words after the code stop at session words (lecture, lec, week, wk, note(s), slide(s), lab, chapter, ch, unit, session, part, midterm, final, exam, quiz, hw, homework), so "BIO 101 Lecture 5 notes" is "BIO 101". This applies to files as well. Note units whose titles overlap (>= 50% tokens) merge, as files do.
3. **Lone notes** (a title group made of exactly one note unit, < 4 pages, no author, no course code) join the most similar group with >= 4 pages when TF-IDF cosine (over title + page texts of each group, computed once before any joins) >= 0.2 (ties: earlier group). Groups of 2+ merged notes are deliberate projects and stay.
4. Remaining lone notes are bucketed: by shared non-generic folder, else by 9.4 lexicon category, else into one group "Loose notes". Bucket titles: the folder name, or "<Category> notes". Bucket groups are type "other" unless 8.3.5 says otherwise.
5. Every group gets `category` from 9.4.

### 9.6 Organize everything
- Sort screen: when >= 2 groups (excluding Unsorted and "Loose notes"), show "Create all <N> projects" above the list, with a line "Books, classes and topics, sorted into <K> categories." It builds every group except Unsorted and "Loose notes" (the notes we could not place stay on Sort for the user to decide; building them would put a packing list on the Continue card) (smart build when available, else offline), sequentially with progress "Building 3 of 12: Atomic Habits", then goes Home. Per project: `focus` "ideas+quotes" with a Quotes lesson only for book projects with >= 3 quote candidates, else "ideas"; `quotesAsked: true` (no per-project questions in bulk mode). A group whose title matches an existing project (case-insensitive) is added to it (extend) instead.
- Each group card shows its category as an editable field. Changing the category writes `Project.category` on creation.
- Event `organize_all {projects, pages, categories, smart}`. Events `project_renamed {projectId}` and `category_changed {projectId}` when the user edits a project after creation (this is how we measure whether automatic organizing was right).

### 9.7 Shelf by category
- Home shelf: when the projects span >= 2 categories, the shelf shows category clusters side by side that wrap onto more shelves: each cluster is a small muted label "Biology (2)" above its spines, sitting on the shelf board (categories sorted by name, spines in creation order, the "+" spine last). With one category, the shelf looks as before.
- Sort cards say "from N notes" instead of "from N files" when every page in the group came from Apple Notes.
- Project screen: category is editable next to the goal date (text field with suggestions from existing categories).

## 10. v4: ideas brought over from BookSaver (OVERRIDES earlier sections where they conflict)

Ported from the sibling project `~/BookSaver` (web `src/lib/words.ts`, `hash.ts`, `sort/identity.ts`, `detect-summary.ts`, `learn/ask.ts`, iOS `LocalStudyAgent.connections`). Parity cases for every pure function below live in `shared/fixtures/v4-cases.json`; both platforms run them.

### 10.1 Data model additions (still `version: 1`, all optional)
- `Page.words?: Array<{ term: string; definition?: string }>` (the page is a word list, 10.2).
- `Page.imageHash?: string` (16 hex chars, dHash of the image, 10.3).
- `Page.pageNumber?: number` (printed page number read from a screenshot, 10.5).

### 10.2 Word lists
- **Detect**, applied to each Apple note body (before 9.3 step 3), pasted text, `.txt`/`.md` files, and photo/screenshot OCR text (for OCR: the recognized lines one per line, status-bar noise dropped, BEFORE paragraph joining, so two short entries are never glued together):
  - Lines are trimmed, empty lines dropped. Bullets stripped: `^\s*(?:(?:[-*•·▪◦–—]|\d{1,4}[.)]|\[[ xX]?\])\s+)+`.
  - `parseWordList(text, title?)`. `vocab` = `\b(words?|vocab(ulary)?|terms?|glossary|definitions?)\b` (case-insensitive). Line 0 is a heading (skipped) when it matches `vocab` and has no separator ("Vocab", "Words I didn't know"), or has >= 2 words and ends with `:`. `vocabHeading` = the heading or the source title (note title, file name) matches `vocab`.
  - A line splits into term and definition at the first separator `\s+[-–—=]+\s+|\s*:\s+|\s*[–—]\s*|\t+`. Term is cleaned (strip leading `"'“‘(` and trailing `"'”’),.;`, collapse spaces). Term-like: 2..48 chars, <= 4 words, matches `^[\p{L}][\p{L}'’\- ]*$`. A line with a separator whose term is not term-like is rejected; a line without separator is a bare term when term-like. Duplicate terms (case-insensitive) collapse, keeping the first definition seen (a later definition fills an empty one).
  - **Wrapped definitions** (photos, narrow notes): a line right after an entry that has a definition is appended to that definition (with one space, counts as an entry line) when it has no bullet, no separator, starts with a lowercase letter, and either has >= 2 words or the definition so far ends with a stopword (4.2 list) ("too eager to" + "please").
  - It is a word list when ALL hold: no course code (8.3.2) in title + text (a class glossary stays with its class, 8.4 makes its definition cards); >= 2 unique entries; entry lines / non-heading lines >= 0.7; and (>= 50% of unique entries have a definition, or `vocabHeading`). So "Grocery list:" + milk, eggs is not a word list, "Vocab" + sonder, limerence is.
- **Pages**: a word-list source becomes ONE page: same kind/source fields as before, `text` = the original non-empty lines joined with `\n`, `words` = the entries, `heading` = "Words".
- **Grouping**: pages with `words` (and no `suggestedTitle`) go into one group, key `w:words`, title **"Words"**, type "other", category "Vocabulary", before any other rule. A group titled "Words" whose title matches an existing project is added to it (9.6 extend). Sort card says "<N> words" instead of a page count.
- **Lessons** (builder, before sections 4/8.4): all `words` entries of the project's pages, in page order then entry order, deduped by term (case-insensitive). Entries with a definition become definition cards exactly like 8.4 (term, definition, statement "Term: definition", question "What is Term?", answer Term, distractors = 3 other terms). Chunks of 12 cards, one theme lesson per chunk, titled "<First term> to <Last term>" (terms as written, first letter uppercased); a single-card chunk is titled with that term. If the project also has non-word pages they build lessons as before, appended after the word lessons. Entries without a definition get no card.
- **Words to define**: the project screen lists entries without a definition ("12 words need a definition") each with a one-line field and Save. Saving writes `definition` on that page's entry and adds a definition card to the last word lesson (a new lesson "<Term> to <Term>" when it already has 12). Event `word_defined {source: "user"}`.
- **Smart**: when Smart organize is on, building a project that has undefined entries first calls `POST /api/define {words: string[] /* max 80 per call */}` -> `{definitions: [{term, definition /* <= 25 words, learner friendly */}]}` and stores them on the entries. Event `word_defined {source: "smart", count}`. 503 or failure: continue offline.
- **Exercise mix**: the class mix (8.5) applies when `project.type === "class"` OR at least half of the lesson's cards are definition cards.

### 10.3 Duplicates at import
- **dHash** (`dHash(pixels9x8)`): image to grayscale (`0.299R + 0.587G + 0.114B`), resized to 9 wide x 8 high (area averaging; web canvas with `imageSmoothingQuality: "high"`, iOS `CGContext` with `.high` interpolation, then luminance), rows top to bottom, for each row 8 bits `left > right ? 1 : 0` (MSB first), each row 2 hex chars: 16 lowercase hex chars. Store on `Page.imageHash` for screenshots and photos.
- `hamming(a, b)` = differing bits (Infinity when lengths differ).
- **Text key**: `normalizeLookup(text)` (NFKD, strip combining marks, lowercase, non-letter/digit runs to one space, trim).
- A new page is a **duplicate** of an existing library page or an earlier page in the same import when either:
  1. text keys are equal and the text has >= 8 words; or
  2. both have `imageHash`, `hamming <= 3`, and stem-token Jaccard (4.2 tokens) of the two texts >= 0.6 (or both texts have < 8 words).
  (dHash alone is not enough: two different pages of the same book look alike at 9x8.)
- Duplicates are dropped. Report adds "<N> were duplicates." Event `import` gets `duplicates`. On iOS the Photos sweep still marks them checked.

### 10.4 Same book, different spelling
- `normalizeTitle(t)` = normalizeLookup(t with `&` -> " and ") with a leading "the/a/an " removed. `baseTitle(t)` = text before the first `\s*[:|]\s+`, `\s+[-–—]\s+` or `\s*\(` (trimmed; the whole title when that is empty). `similarity(a, b)` = 1 - levenshtein(a, b) / max(len) (1 when both empty).
- `titlesMatch(a, b)`: false when either normalized title is empty, **or when the digit runs of the two normalized titles differ** ("BIO 101" vs "BIO 102", "Dune" vs "Dune 2"). Then true when: normalized titles are equal; or normalized base titles are equal; or the shorter title's tokens are a leading prefix of the longer's and the shorter has >= 5 letters without spaces; or (for both the full and the base pair) both are >= 6 chars and similarity >= 0.85.
- `sameAuthor(a, b)`: both non-empty after normalizeLookup (leading "by " dropped); equal; or the last token (> 1 char) of either appears among the other's tokens; or similarity >= 0.85.
- Used by grouping: after all groups are formed (before 9.5.3 lone-note joins), groups that are not course groups (`c:`), not "Words", not Unsorted and not buckets merge when their titles match and their authors do not conflict (both authors set and `!sameAuthor` blocks the merge). The merged group keeps the title of the group with more pages (ties: the shorter title), the first author found, and `book` if either was a book. Also used wherever a group is matched to an existing project (Sort "Add to <project>", 9.6 extend) instead of case-insensitive equality.

### 10.5 Page numbers (screenshots)
- `pageNumberFromLines(lines)` over the header and footer zone lines (3.1) before they are dropped, footer lines first: `\bpage\s+(\d{1,4})\b` or `\bp\.\s*(\d{1,4})\b` (case-insensitive) -> that number; `^(\d{1,4})\s+of\s+\d{1,5}$` -> the first number; a line that is exactly `\d{1,4}` -> that number. Lines with "left" (pages left in chapter) or `%` are ignored. 0 is ignored. Store on `Page.pageNumber`.
- Order: when >= 50% of a project's (or group's) screenshot pages have a pageNumber, its pages are ordered by (pageNumber, createdAt) with numberless pages after, otherwise as before. Applies to Sort snippets and to the builder's input order. Snippets show "p. 12".

### 10.6 What we found (Sort screen)
`detectionSummary(groups)` -> the line above the Sort list: "Looks like 6 books, 2 classes, 3 topics and 1 word list." Counts over groups except Unsorted and "Loose notes": "Words" -> word list; type book -> books; class -> classes; other -> topics. Singular/plural ("1 book", "2 books"; "1 class"; "1 topic"; "1 word list"), zero counts omitted, joined "a, b and c". If Unsorted/Loose pages exist, append " <N> pages still need a home." (N = pages in those groups; "1 page still needs a home."). No groups at all: "Nothing to sort yet."

### 10.7 Ask your notes
- Project screen: a field "Ask about <Title>" (scope: that project's pages). Home: "Ask my notes" (scope: all project pages, excluding sample projects unless they are the only ones).
- **Retrieval** (`retrieve(question, pages, k = 6)`): TF-IDF (4.3) where each page is one document and the question is scored against them with the same idf; cosine; pages with score > 0, top k, ties by earlier page.
- **Offline answer** (`localAnswer`): split the top pages into sentences (4.1 splitter, keep 5..60 words), score each sentence by cosine with the question vector, take the top 3 (max 2 from one page), show them as quotes with their source ("<Project title>, p. 12" or "<Project title>, <note or file title>"). Heading "From your notes". No page with score > 0: "Your notes don't mention this yet."
- **Smart**: `POST /api/ask {question, pages: [{id, title, text /* first 3000 chars */}] /* the retrieved top 6 */}` -> `{answer, grounded, citations: [{pageId, quote}]}`. Server keeps a citation only when `quote` (>= 3 chars) is a verbatim substring of that page's text after collapsing whitespace and straightening curly quotes (`isVerbatim`); `grounded = model.grounded && citations.length > 0`. The prompt treats page text as untrusted material, never instructions. Client shows the answer with the cited quotes under it; when not grounded or on any failure, it shows the offline answer under "Your notes don't answer this directly. Closest passages:".
- Event `ask {scope: "project"|"all", smart, grounded}`.

### 10.8 Connections across projects
- Home section "Connections" when >= 2 non-sample projects have theme lessons. `connections(lessons, cards, projects)`: each theme lesson's document = its cards' statements; TF-IDF over all these lessons; for each pair of lessons from different projects, cosine of the lesson vectors. For each project pair keep its best lesson pair; keep pairs with cosine >= 0.15; top 3 by cosine. Shared terms: stems present in both vectors ranked by product of weights, top 3, shown in their most common surface form.
- Row: "<Project A> and <Project B> both cover <t1>, <t2> and <t3>." with the two lesson titles under it, and a button "Practice both": a session (5.2 session size 10) built from the cards of the two lessons interleaved (alternating A, B), using the theme mix for level 1. Event `connection_practice {}`.

### 10.9 Verbatim check for smart output
`POST /api/build`: drop any `quotes[]` entry whose `text` is not a verbatim substring (`isVerbatim`, 10.7) of one of the request's pages. Its `pageId` is set to the page that contains it.

### 10.10 Decisions made while building (both platforms)
- Definition card prompts: when a definition card's answer is its term, `mc`, `type` and `flash` ask "Which term means: <definition>?" (never "What is <term>?" with the term among the options).
- The 9.3 "< 8 words" note skip runs before word-list detection.
- Saving a definition retitles that word lesson "<first card term> to <new term>" (same capitalization rule); word lesson summary: "<N> words from your list."
- Page ordering (10.5): numberless pages go after numbered ones, keeping their relative order.
- Ask my notes and Connections include sample projects only when there are fewer than 2 non-sample projects.
- Offline Ask: when the top page has no 5..60 word sentence, show that page's text cut to 280 chars.
- Word-list card terms keep the user's casing; only lesson titles are capitalized.
- Word pages never go to `/api/sort` or `/api/build`: they always group and build offline.
- The Ask fallback heading "Your notes don't answer this directly. Closest passages:" is used only when a smart answer was attempted; offline it is "From your notes".

## 11. v5: pictures in lessons, profile, accounts and the subscription (OVERRIDES earlier sections where they conflict)

### 11.1 Source images
- Any card whose `pageId` points to a page with an `image` shows that image:
  - in exercise feedback (after answering, correct or not): a small thumbnail (max 96pt/px tall, rounded) labeled "From your page" (+ " p. 12" when `pageNumber`); tap opens it full screen (pinch zoom on iOS, click to close on web).
  - in the lesson's card list on the project/lesson screen.
- `flash` and `explain` show the thumbnail on the reveal side.
- Images never leave the device except as before (smart read). Export still omits images.

### 11.2 Picture cards
- New card kind: `kind: "picture"` (Card fields: `pageId` required, `statement` = the page's text or `heading` cut to 280 chars, `question` = "What does this page show?" or "What's on this page about <heading>?" when a heading exists).
- Built for pages with an `image` and kind `photo` (whiteboards, handwritten notes, diagrams) and for screenshots whose OCR text is < 40 words (diagrams in a book). One per page, max 12 per lesson. They join the lesson their page's text belongs to (the page's cards' lesson, or the lesson whose centroid is closest by 4.3 cosine); if none, a lesson "Pictures" is added to the project.
- Exercise `picture` (only for picture cards): show the image large, prompt `question`, "Show me" reveals `statement` under it, self grade Got it / Partly / Missed it (good / hard / again). Counts as one exercise; at most 3 per session; never first in a session. Used in theme and class mixes at every level and in Practice (review) when due. Practice tests skip picture cards.
- SRS, XP and the plan treat them like other cards (the plan's minutes estimate counts 0.3 min per picture card as for reviews).
- Decisions: the cap of 3 and "never first" apply when the session also has other cards; a lesson (or a Practice with only pictures due) made only of picture cards plays them in every slot (up to the session length). Picture cards fill slots of the session length (a theme session is still 10). Picture cards never feed other exercise types or distractor pools. Word-list pages never become picture cards. A picture whose best lesson already has 12 goes to "Pictures" ("Pictures 2", ... when that fills). Smart builds get picture cards too (added on the client after the build). The lesson sheet lists its cards ("In this lesson", max 20) with a small page thumbnail.

### 11.3 Profile
- Web `/app/profile`, iOS a Profile screen (Home top bar: a round avatar with the user's initial, or a person icon when signed out, opens it; Settings stays reachable from Profile and the existing entry).
- `profile.name?: string` is part of the Library profile (exported; old files load without it). The avatar initial is the first letter of the name, else of the account email.
- With billing off (no accounts configured) the Subscription section reads "Accounts and subscriptions are not set up on this server yet. Everything is unlocked." and shows no account buttons. Stats: sessions = count of `session_done` events; "Studying since <date>" from the first event.
- Shows: name (editable, stored in `profile.name?: string`, default from the account or empty), email when signed in, member since (first event date), stats (total XP, current and longest streak, projects, cards learned = cards with reps >= 1, sessions done), subscription status line ("Free trial: 5 days left", "OpenStudy Plus, renews Nov 20", "Free for you" for comped accounts, "Not subscribed"), buttons: Manage subscription (iOS: `AppStore.showManageSubscriptions`; web: Stripe customer portal), Restore purchases (iOS), Sign in / Sign out, Delete account (confirm; deletes the server account, keeps the local library).

### 11.4 Accounts
- Provider: Supabase Auth (one project for web and iOS). Methods: Sign in with Apple (iOS native, web via OAuth) and email magic link. The email holds only a link: Supabase's free plan with its built-in mailer can't change the email template, so there is no code to type. The iOS link redirects to `openstudy://auth-callback` (PKCE), the web link to `/auth/callback`; both are in the project's redirect allow list, and the site URL is the production domain. Adding a code needs a custom SMTP provider. The library stays local (no sync in this version); the account exists for the subscription.
- Server table `entitlements (user_id uuid pk references auth.users, status text /* trialing|active|past_due|canceled|expired|comp */, source text /* apple|stripe|comp */, product text, renews_at timestamptz, trial_ends_at timestamptz, original_transaction_id text, stripe_customer_id text, updated_at timestamptz)`. Row level security: a user can read only their own row; only the server (service role) writes.
- `GET /api/me` (Supabase JWT in `Authorization: Bearer`) -> `{user: {id, email}, entitlement: {active: boolean, status, source, renewsAt?, trialEndsAt?}}`. `active` = status in (trialing, active, comp) and not past its end date.
- **Comp (free for the owner)**: env `OPENSTUDY_COMP_EMAILS` (comma separated, case-insensitive). `/api/me` returns `status: "comp", active: true` for those emails, with no purchase. The owner's emails go there (ancientbest@gmail.com, shoberman@icloud.com).

### 11.5 Subscription: OpenStudy Plus, $10 a month, 7-day free trial
- iOS: StoreKit 2 auto-renewable subscription, product id `com.openstudy.shelf.plus.monthly`, group "OpenStudy Plus", price $10.00 USD (App Store Connect price point), introductory offer: 7-day free trial. Pass `appAccountToken` = the Supabase user id (UUID) when purchasing. After a purchase/restore the app POSTs the signed transaction (`jwsRepresentation`) to `POST /api/apple/transaction`, which verifies it with Apple's root certificates (App Store Server Library), checks bundle id + product, and upserts the entitlement. App Store Server Notifications v2 at `POST /api/apple/notifications` keep it current (renewals, expirations, refunds). A local `.storekit` configuration file in the Xcode scheme makes purchases testable in the simulator.
- Web: Stripe Checkout (mode subscription, price $10.00/month recurring, `subscription_data.trial_period_days: 7`, `client_reference_id` = user id) from `POST /api/stripe/checkout`; `POST /api/stripe/webhook` (signature verified) upserts the entitlement on `checkout.session.completed`, `customer.subscription.updated|deleted`; `POST /api/stripe/portal` opens the billing portal.
- One subscription unlocks both: entitlement is per account, whichever store it came from. A user subscribed through Apple is not offered Stripe and vice versa ("You subscribe through the App Store. Manage it on your iPhone.").
- **What is locked**: free without an account and without a subscription: onboarding, the sample library, importing and sorting (so people see their own notes organized). Creating a project from Sort ("Create project", "Create all") and studying non-sample projects need an active entitlement. The paywall appears at that moment, not at launch.
- **Paywall screen** (both): title "Keep everything you saved, and learn it.", three plain lines of what Plus gives (all your projects and lessons, the study plan and practice tests, smart organize and Ask), price line "7 days free, then $10 a month. Cancel anytime.", primary "Start free trial" (signs in first if needed), secondary "Restore purchases" (iOS) / "I already subscribe" (web: sign in), links to Terms and Privacy, close button. No fake urgency, no countdowns.
- Offline grace: the last known entitlement is cached locally with its end date; when the server cannot be reached the cached state is used until that date + 3 days.
- Events: `paywall_view {from}`, `trial_start {source}`, `subscribe {source}`, `paywall_close {}`, `restore {ok}`. Cohort metric: trial starts by week, and the share converting to paid at day 8.
- Without Supabase/Stripe/Apple configured (env vars missing) the server routes return 503 `{error: "billing_off"}` and clients treat everything as unlocked (development builds only; a release build with billing off shows the paywall's "Not available yet" state).

## 12. v6: password accounts, welcome email, usage data and the OpenStudy MCP (OVERRIDES 11.4 where they conflict)

### 12.1 Email and password
- Sign-in is email + password on both platforms. No codes, no sign-in links, no confirmation email: the Supabase project has `mailer_autoconfirm` on, so sign-up returns a session at once. (The built-in mailer allows only a few emails an hour, which caused "too many emails".)
- One screen with two modes: "Create account" (email, password of 8+ characters) and "Sign in". Errors: "That email already has an account. Sign in instead." / "Wrong email or password." / "Use at least 8 characters." / "Could not reach OpenStudy. Check your connection."
- iOS: Supabase REST `POST /auth/v1/signup {email,password}` and `POST /auth/v1/token?grant_type=password {email,password}`. Web: `supabase.auth.signUp` / `signInWithPassword`.
- Forgot password: `POST /api/auth/reset {email}` always answers `{ok:true}`; when the account exists and email is set up, the server makes a recovery link (`auth.admin.generateLink({type:"recovery"})`, redirect `/auth/reset`) and sends it through Resend. `/auth/reset` (web page, works from the iPhone's browser too) sets the new password. Without email set up the client says "Password reset by email is not set up yet. Write to support."
- After a successful sign-up the client calls `POST /api/welcome` (Bearer token). The server sends the welcome email once per user (`app_metadata.welcomed_at`), logs a `signup` event, and answers `{sent: boolean}`. A failed welcome never blocks sign-up.

### 12.2 Welcome email (Resend)
- From `OpenStudy <hello@${OPENSTUDY_MAIL_DOMAIN}>` when that env var is set, else `OpenStudy <onboarding@resend.dev>` (Resend only delivers that to the Resend account's own address until a domain is verified).
- Subject "Welcome to OpenStudy". Body: one short paragraph (what OpenStudy does), three steps (add your notes, sort them into books and classes, study a few minutes a day), the trial line "Lessons and your study plan come with OpenStudy Plus: 7 days free, then $10 a month.", and a button to open the app (`https://openstudy-psi.vercel.app/app`). Plain HTML, no images.

### 12.3 Usage data
- Every client already keeps `library.events` (`{t, name, props}`). Those events are also sent to the server, so the owner can see how OpenStudy is used. Never sent: page text, titles, authors, file names, word lists, answers, emails typed into the library. Props are categories and counts only.
- Client: an `installId` (random UUID, made once, kept in localStorage / UserDefaults) and a cursor (the `t` of the last event sent). Events after the cursor go in batches of at most 200 to `POST /api/events` `{installId, platform: "web"|"ios", appVersion, events:[{t,name,props}]}`, with the Supabase Bearer token when signed in. Sent 3 seconds after an event is logged (debounced), on app start and when the app goes to the background. A failed send keeps the cursor, so it retries later.
- Opt out: Profile has "Share usage data" (on by default). Off means nothing is sent and the cursor jumps to now when it is turned back on (past events stay private).
- Server sanitizes before storing: `name` matches `^[a-z_]{2,40}$`; props keep only allowlisted keys: kind, source, scope, from, type, category, types, categories, lessonKind, level, goal, practice, bringing, dailyGoalXP, count, pages, lessons, projects, files, skipped, duplicates, checked, found, accuracy, seconds, xp, questions, yes, ok, smart, grounded, groups, books, classes, others, words. Values: numbers, booleans, or strings up to 60 characters (strings only for: kind, source, scope, from, type, category, types, categories, lessonKind, goal, practice, bringing). Unknown keys are dropped. Max 200 events per request, `t` must be within the last 30 days and not more than 1 day ahead. Table `events (id bigserial, t timestamptz, received_at, install_id uuid, user_id uuid null, platform text, app_version text, name text, props jsonb)`, service-role only (RLS on, no policies).
- New or richer events, same names on both platforms:
  - `import`: `kind` (photo, scan, camera, screenshot, files, note, words, notes_app, paste), `count`, `skipped`, `duplicates`, and for files `types` like `"pdf:2,image:5,pptx:1"` (by extension group: pdf, image, pptx, docx, text, json, other).
  - `sort_done` when the Sort screen first groups a set of new pages: `pages`, `groups`, `books`, `classes`, `others`, `categories` (comma list of group categories, e.g. "Biology,Reading,Work").
  - `project_created`: `type` (book, class, other), `category`, `pages`, `lessons`.
  - `category_changed`: `category` (the new one).
  - `signup` (server), `sign_in` (client, after a password sign-in), `app_open` (client, once per launch).
- The privacy page lists this.

### 12.4 OpenStudy MCP (owner analytics)
- Remote MCP server at `/api/mcp` (Streamable HTTP, stateless), for Claude Code, Claude Desktop/claude.ai custom connectors and Codex. Auth: `Authorization: Bearer ${OPENSTUDY_MCP_TOKEN}`; without the env var the route answers 503, with a wrong token 401. Read-only.
- Tools (all take `days`, default 30, max 365, except where noted):
  - `overview`: accounts (total, new in window), installs active in window by platform, Plus (trialing, active, comp, canceled), events in window, top 10 event names.
  - `uploads`: `import` events grouped by kind and by file type (`types`), with pages added, skipped and duplicates; split by platform; per-day series.
  - `sorting`: `project_created` by type and by category, `sort_done` group mix, `category_changed` targets, and the share of pages that end up in projects.
  - `funnel`: weekly install cohorts (`weeks`, default 8): installs, then % with an import, % with a project, % with a finished session, % signed up, % on Plus. Each step counts installs, not events.
  - `study`: sessions and reviews finished, average accuracy, minutes, XP, by lesson kind.
  - `events`: raw recent events, optional `name`, `platform`, `limit` (default 50, max 500).
  - `users`: accounts with created date, Plus status, last event time and event count; optional `email` substring; `limit` default 50.
- Connect: Claude Code `claude mcp add --transport http openstudy https://openstudy-psi.vercel.app/api/mcp --header "Authorization: Bearer <token>"`; Codex `~/.codex/config.toml` `[mcp_servers.openstudy] url = ".../api/mcp"`, `bearer_token_env_var = "OPENSTUDY_MCP_TOKEN"`.

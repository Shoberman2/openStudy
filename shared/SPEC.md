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

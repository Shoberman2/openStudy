import XCTest

final class EngineTests: XCTestCase {
    var utc: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }()

    func sampleLibrary() throws -> Library {
        let url = try XCTUnwrap(Bundle(for: EngineTests.self).url(forResource: "sample-library", withExtension: "json"))
        return try Library.decode(Data(contentsOf: url))
    }

    // MARK: Models

    func testSampleDecodesAndRoundTrips() throws {
        let lib = try sampleLibrary()
        XCTAssertEqual(lib.projects.count, 3)
        XCTAssertEqual(lib.cards.count, 50)
        XCTAssertTrue(lib.cards.allSatisfy { $0.srs.state == "new" && $0.srs.ease == 2.5 })
        let data = try lib.exportData()
        let back = try Library.decode(data)
        XCTAssertEqual(back.cards.map(\.id), lib.cards.map(\.id))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["version"] as? Int, 1)
        XCTAssertNotNil(json["profile"]); XCTAssertNotNil(json["stats"]); XCTAssertNotNil(json["events"])
        let page = try XCTUnwrap((json["pages"] as? [[String: Any]])?.first)
        XCTAssertNotNil(page["projectId"])
    }

    func testMergeById() throws {
        var a = try sampleLibrary()
        var b = a
        b.lessons[0].level = 3
        b.projects.append(Project(id: "newproj001", title: "New", color: .green))
        a.merge(b)
        XCTAssertEqual(a.projects.count, 4)
        XCTAssertEqual(a.lessons[0].level, 3)
        XCTAssertEqual(a.cards.count, 50)
    }

    // MARK: Notes parser (3.2)

    func testNotesExcerptParsingMultiple() {
        let blob = """
        \u{201C}The only way to get the best of an argument is to avoid it.\u{201D}

        Excerpt From
        How to Win Friends and Influence People
        Dale Carnegie
        This material may be protected by copyright.

        You have power over your mind, not outside events. Realize this, and you will find strength.

        Excerpt From
        Meditations
        Marcus Aurelius
        This material may be protected by copyright.
        Let us go forth.

        Excerpt From
        Meditations
        Marcus Aurelius
        This material may be protected by copyright.
        """
        let ex = NotesParser.parse(blob)
        XCTAssertEqual(ex.count, 3)
        XCTAssertEqual(ex[0].text, "The only way to get the best of an argument is to avoid it.")
        XCTAssertEqual(ex[0].title, "How to Win Friends and Influence People")
        XCTAssertEqual(ex[0].author, "Dale Carnegie")
        XCTAssertEqual(ex[1].title, "Meditations")
        XCTAssertEqual(ex[1].author, "Marcus Aurelius")
        XCTAssertTrue(ex[1].text.hasPrefix("You have power"))
        XCTAssertEqual(ex[2].text, "Let us go forth.")
        XCTAssertTrue(ex.allSatisfy(\.fromFooter))
    }

    func testNotesWithoutFooter() {
        let text = """
        Atomic Habits notes
        - Habits are the compound interest of self-improvement.
        - You do not rise to the level of your goals. You fall to the level of your systems.

        Every action is a vote for the type of person you wish to become.
        """
        let ex = NotesParser.parse(text)
        XCTAssertEqual(ex.count, 3)
        XCTAssertTrue(ex.allSatisfy { $0.title == "Atomic Habits notes" })
        XCTAssertEqual(ex[0].text, "Habits are the compound interest of self-improvement.")
    }

    // MARK: Screenshot cleanup (3.1)

    func testScreenshotCleanerHeaderFooterAndHyphens() {
        let lines = [
            OCRLine(text: "9:41", top: 0.01, bottom: 0.03),
            OCRLine(text: "Six Ways to Make People Like You", top: 0.05, bottom: 0.07),
            OCRLine(text: "You can make more friends in two months by becoming inter-", top: 0.12, bottom: 0.14),
            OCRLine(text: "ested in other people than you can in two years by trying to", top: 0.145, bottom: 0.165),
            OCRLine(text: "get other people interested in you. Which is just another way", top: 0.17, bottom: 0.19),
            OCRLine(text: "of saying that the way to make a friend is to be one. Remember", top: 0.195, bottom: 0.215),
            OCRLine(text: "that a person's name is to that person the sweetest sound in any language.", top: 0.22, bottom: 0.24),
            OCRLine(text: "12 of 280", top: 0.95, bottom: 0.97),
        ]
        let c = ScreenshotCleaner.clean(lines)
        XCTAssertEqual(c.header, "Six Ways to Make People Like You")
        XCTAssertTrue(c.body.contains("becoming interested in other"))
        XCTAssertFalse(c.body.contains("280"))
        XCTAssertTrue(c.isBookPage)
        XCTAssertFalse(ScreenshotCleaner.isBookText("Settings Wi-Fi Bluetooth 12 34 56"))
    }

    // MARK: Sentences (4.1)

    func testSentenceSplitKeepsAbbreviations() {
        let s = TextKit.sentences("Mr. Smith met Dr. Jones at noon. They talked, e.g. about books! Did it help? \u{201C}Yes,\u{201D} he said. Then they left.")
        XCTAssertEqual(s, ["Mr. Smith met Dr. Jones at noon.", "They talked, e.g. about books!", "Did it help?", "\u{201C}Yes,\u{201D} he said.", "Then they left."])
    }

    func testStemming() {
        XCTAssertEqual(TextKit.stem("listening"), "listen")
        XCTAssertEqual(TextKit.stem("friends"), "friend")
        XCTAssertEqual(TextKit.stem("sing"), "sing")
        XCTAssertEqual(TextKit.stem("wanted"), "want")
        XCTAssertFalse(TextKit.tokens("The people and the things").contains("the"))
    }

    // MARK: Builder (4)

    func testBuilderFromSamplePages() throws {
        let lib = try sampleLibrary()
        let pages = lib.pages.filter { $0.projectId == "smpcarnegi" }
        let r = LessonBuilder.build(pages: pages, author: "Dale Carnegie")
        XCTAssertGreaterThanOrEqual(r.lessons.count, 2, "chapter headers should group into lessons")
        XCTAssertTrue(r.lessons.contains { $0.title == "Fundamental Techniques in Handling People" })
        let cards = r.lessons.flatMap(\.cards)
        XCTAssertGreaterThan(cards.count, 8)
        for c in cards {
            XCTAssertTrue(c.statement.contains(c.cloze), "cloze must be a substring")
            XCTAssertGreaterThanOrEqual(c.cloze.count, 4)
            XCTAssertTrue(c.question.contains("____"))
            XCTAssertEqual(c.distractors.count, 3)
            XCTAssertNotEqual(c.falseStatement, c.statement)
            let wc = TextKit.wordCount(c.statement)
            XCTAssertTrue((7...45).contains(wc))
        }
        XCTAssertTrue(r.lessons.allSatisfy { $0.cards.count <= 14 && $0.summary.count <= 120 })
        XCTAssertFalse(r.quotes.isEmpty)
        XCTAssertLessThanOrEqual(r.quotes.count, 20)
        XCTAssertTrue(r.quotes.contains { $0.text.hasPrefix("The only way to get the best of an argument") })
        XCTAssertTrue(r.quotes.allSatisfy { $0.attribution == "Dale Carnegie" })
    }

    func testBuilderKMeansWithoutHeaders() throws {
        let lib = try sampleLibrary()
        let pages = lib.pages.map { p -> Page in var q = p; q.header = nil; return q }
        let r = LessonBuilder.build(pages: pages)
        XCTAssertGreaterThanOrEqual(r.lessons.count, 1)
        XCTAssertTrue(r.lessons.allSatisfy { $0.title.contains("&") || !$0.title.isEmpty })
        let again = LessonBuilder.build(pages: pages)
        XCTAssertEqual(r, again, "builder must be deterministic")
    }

    func testCreateProjectPlacesQuotesSecond() throws {
        let lib0 = try sampleLibrary()
        var lib = Library()
        let pages = lib0.pages.filter { $0.projectId == "smpcarnegi" }.map { p -> Page in var q = p; q.projectId = nil; return q }
        lib.pages = pages
        let r = LessonBuilder.build(pages: pages, author: "Dale Carnegie")
        let p = lib.createProject(title: "HTWF", author: "Dale Carnegie", pageIds: pages.map(\.id), build: r, focus: "ideas+quotes", quotes: r.quotes)
        let ls = lib.lessons(of: p.id)
        XCTAssertEqual(ls[1].kind, "quotes")
        XCTAssertTrue(lib.inbox.isEmpty)
        XCTAssertEqual(lib.cards(of: ls[1].id).count, r.quotes.count)
        XCTAssertTrue(lib.isUnlocked(ls[1]))
        XCTAssertFalse(lib.isUnlocked(ls[2]))
    }

    // MARK: Grouping (3.3)

    func testGroupingByTitleAndHeader() {
        let pages = [
            Page(id: "a", kind: "note", text: "Be one.", suggestedTitle: "Meditations"),
            Page(id: "b", kind: "note", text: "Change is nature.", suggestedTitle: "meditations"),
            Page(id: "c", kind: "screenshot", text: "Criticism is futile and dangerous for pride.", header: "Chapter One 12"),
            Page(id: "d", kind: "screenshot", text: "Appreciation is sincere and criticism hurts pride.", header: "Chapter One 13"),
            Page(id: "e", kind: "screenshot", text: "Criticism wounds pride and arouses resentment.", header: "Lonely header"),
            Page(id: "f", kind: "screenshot", text: "Quantum chromodynamics gluon lattice.", header: nil),
        ]
        let g = Grouper.group(pages)
        XCTAssertEqual(g.first { $0.title == "Meditations" }?.pageIds, ["a", "b"])
        let ch = g.first { $0.pageIds.contains("c") }
        XCTAssertEqual(ch?.pageIds.sorted(), ["c", "d", "e"])
        XCTAssertEqual(g.first { $0.title == Grouper.unsorted }?.pageIds, ["f"])
    }

    // MARK: SRS (5.4)

    func testSRSTransitions() {
        let now = ISO.date("2026-10-16T12:00:00.000Z")!
        var s = Srs.fresh(now: now)
        s = SRSEngine.review(s, grade: .good, now: now, calendar: utc)
        XCTAssertEqual(s.state, "review"); XCTAssertEqual(s.reps, 1); XCTAssertEqual(s.interval, 1)
        XCTAssertEqual(s.due, "2026-10-17T00:00:00.000Z")
        s = SRSEngine.review(s, grade: .good, now: now, calendar: utc)
        XCTAssertEqual(s.interval, 3)
        s = SRSEngine.review(s, grade: .easy, now: now, calendar: utc)
        XCTAssertEqual(s.interval, Int((3 * 2.5 * 1.3).rounded()))
        XCTAssertEqual(s.ease, 2.65, accuracy: 0.001)
        s = SRSEngine.review(s, grade: .hard, now: now, calendar: utc)
        XCTAssertEqual(s.ease, 2.5, accuracy: 0.001)
        let before = s
        s = SRSEngine.review(s, grade: .again, now: now, calendar: utc)
        XCTAssertEqual(s.state, "learning"); XCTAssertEqual(s.reps, 0); XCTAssertEqual(s.interval, 0)
        XCTAssertEqual(s.lapses, before.lapses + 1)
        XCTAssertEqual(s.ease, 2.3, accuracy: 0.001)
        XCTAssertEqual(s.due, "2026-10-16T12:10:00.000Z")
        var low = Srs.fresh(now: now); low.ease = 1.35
        low = SRSEngine.review(low, grade: .again, now: now, calendar: utc)
        XCTAssertEqual(low.ease, 1.3, accuracy: 0.001)
        XCTAssertEqual(low.lapses, 0, "no lapse when reps was 0")
        XCTAssertEqual(SRSEngine.grade(for: .correct, kind: .type, seconds: 3), .easy)
        XCTAssertEqual(SRSEngine.grade(for: .correct, kind: .mc, seconds: 3), .good)
        XCTAssertEqual(SRSEngine.grade(for: .close, kind: .type, seconds: 3), .hard)
        XCTAssertEqual(SRSEngine.grade(for: .wrong, kind: .type, seconds: 3), .again)
    }

    // MARK: Answer checking (5.3)

    func testFuzzyAnswerChecking() {
        XCTAssertEqual(AnswerChecker.normalize("The  Defensive!"), "defensive")
        XCTAssertEqual(AnswerChecker.check("defensive", against: "defensive"), .correct)
        XCTAssertEqual(AnswerChecker.check("the Defensive.", against: "Defensive"), .correct)
        XCTAssertEqual(AnswerChecker.check("defensve", against: "defensive"), .close)
        XCTAssertEqual(AnswerChecker.check("appreciation", against: "apreciation"), .close)
        XCTAssertEqual(AnswerChecker.check("offensive", against: "defensive"), .wrong)
        XCTAssertEqual(AnswerChecker.check("", against: "defensive"), .wrong)
        XCTAssertEqual(AnswerChecker.check("cat", against: "car"), .close)
    }

    func testQuoteLCSScoring() {
        let target = "The only way to get the best of an argument is to avoid it."
        XCTAssertEqual(AnswerChecker.checkQuote("The only way to get the best of an argument is to avoid it", against: target), .correct)
        XCTAssertEqual(AnswerChecker.lcsRatio("the only way to get the best of an argument is to avoid it", target), 1, accuracy: 0.0001)
        // 13 target words; drop 2 -> 11/13 = 0.846 -> close
        XCTAssertEqual(AnswerChecker.checkQuote("The only way to get the best of argument is avoid it", against: target), .close)
        XCTAssertEqual(AnswerChecker.checkQuote("Avoid arguments", against: target), .wrong)
        let d = AnswerChecker.diff("The only way to win an argument is to avoid it", target)
        XCTAssertTrue(d.contains(DiffToken(word: "win", kind: .extra)))
        XCTAssertTrue(d.contains { $0.kind == .missing && $0.word == "best" })
        XCTAssertEqual(d.filter { $0.kind != .extra }.map(\.word).joined(separator: " "), target)
    }

    // MARK: XP / streak (5.5)

    func testStreakWithGapsAndFreezes() {
        func day(_ s: String) -> Date { ISO.date(s + "T10:00:00.000Z")! }
        var st = Stats()
        ProgressEngine.award(5, to: &st, now: day("2026-10-01"), calendar: utc)
        XCTAssertEqual(st.streak, 1); XCTAssertEqual(st.xp, 5)
        ProgressEngine.award(3, to: &st, now: day("2026-10-01"), calendar: utc)
        XCTAssertEqual(st.streak, 1, "same day: no change"); XCTAssertEqual(st.dayXP["2026-10-01"], 8)
        for d in 2...7 { ProgressEngine.award(1, to: &st, now: day(String(format: "2026-10-%02d", d)), calendar: utc) }
        XCTAssertEqual(st.streak, 7); XCTAssertEqual(st.freezes, 1, "7th day grants a freeze")
        // One-day gap (10-08 missed) consumes the freeze.
        ProgressEngine.award(1, to: &st, now: day("2026-10-09"), calendar: utc)
        XCTAssertEqual(st.streak, 8); XCTAssertEqual(st.freezes, 0)
        // One-day gap without a freeze resets.
        ProgressEngine.award(1, to: &st, now: day("2026-10-11"), calendar: utc)
        XCTAssertEqual(st.streak, 1)
        XCTAssertEqual(st.longestStreak, 8)
        // Long gap resets even with freezes.
        st.freezes = 2
        ProgressEngine.award(1, to: &st, now: day("2026-10-20"), calendar: utc)
        XCTAssertEqual(st.streak, 1); XCTAssertEqual(st.freezes, 2)
        XCTAssertEqual(ProgressEngine.displayStreak(st, now: day("2026-10-21"), calendar: utc), 1)
        XCTAssertEqual(ProgressEngine.displayStreak(st, now: day("2026-10-25"), calendar: utc), 0)
        // Freezes cap at 2.
        var s2 = Stats(); s2.freezes = 2; s2.streak = 13; s2.lastActiveDay = "2026-10-01"
        ProgressEngine.award(1, to: &s2, now: day("2026-10-02"), calendar: utc)
        XCTAssertEqual(s2.streak, 14); XCTAssertEqual(s2.freezes, 2)
        XCTAssertEqual(ProgressEngine.sessionXP(correctFirstAttempts: 10, completed: true, mistakes: 0, applies: 1), 28)
    }

    // MARK: Session (5.2)

    func testSessionBuilderMixAndRequeue() throws {
        var lib = try sampleLibrary()
        lib.profile.practice = ["tap", "blank"]
        let lesson = lib.lessons.first { $0.id == "lc1" }!
        var rng = SeededRNG(seed: 42)
        let ex = SessionBuilder.build(lesson: lesson, cards: lib.cards, profile: lib.profile, rng: &rng)
        XCTAssertEqual(ex.count, 10)
        XCTAssertNotEqual(ex.first?.kind, .type)
        XCTAssertTrue(ex.allSatisfy { [.mc, .tf, .match, .bank].contains($0.kind) })
        for (a, b) in zip(ex, ex.dropFirst()) { XCTAssertFalse(a.kind == .match && b.kind == .match) }
        var usage: [String: Int] = [:]
        for e in ex { for id in e.cardIds { usage[id, default: 0] += 1 } }
        var primary: [String: Int] = [:]; for e in ex { primary[e.cardId, default: 0] += 1 }; XCTAssertTrue(primary.values.allSatisfy { $0 <= 2 })
        for e in ex where e.kind == .mc { XCTAssertEqual(e.options.count, 4); XCTAssertTrue(e.options.contains(e.answer)) }
        for e in ex where e.kind == .bank { XCTAssertEqual(e.blanks.count, 1); XCTAssertTrue(e.options.contains(e.blanks[0])) }

        var state = SessionState(exercises: ex)
        let firstCard = state.current!.cardIds[0]
        let g = state.submit(.wrong)
        XCTAssertEqual(g[firstCard], .again)
        XCTAssertEqual(state.queue.count, 11, "mistake is re-queued")
        XCTAssertTrue(state.queue.last!.isRetry)
        state.advance()
        while let cur = state.current {
            let fresh = state.submit(.correct, seconds: 10)
            if cur.isRetry { XCTAssertNil(fresh[firstCard], "graded once per session") }
            state.advance()
        }
        XCTAssertTrue(state.isFinished)
        XCTAssertEqual(state.correct, 10)
        XCTAssertEqual(state.progress, 1)
        XCTAssertEqual(state.firstAttemptCorrect, 9)
        XCTAssertEqual(state.mistakes, 1)
        XCTAssertEqual(state.xp, 9 + 10)
    }

    func testQuoteSessionsByLevel() throws {
        let lib = try sampleLibrary()
        var lesson = lib.lessons.first { $0.id == "lcq" }!
        var rng = SeededRNG(seed: 7)
        let l0 = SessionBuilder.build(lesson: lesson, cards: lib.cards, profile: lib.profile, rng: &rng)
        XCTAssertEqual(l0.count, 8)
        XCTAssertTrue(l0.allSatisfy { $0.kind == .qBank1 })
        lesson.level = 2
        let l2 = SessionBuilder.build(lesson: lesson, cards: lib.cards, profile: lib.profile, rng: &rng)
        XCTAssertTrue(l2.allSatisfy { [.qBank3, .qOrder, .qBank1].contains($0.kind) })
        for e in l2 where e.kind == .qOrder { XCTAssertTrue((3...5).contains(e.chunks.count)); XCTAssertEqual(e.chunks.joined(separator: " "), lib.cards.first { $0.id == e.cardId }!.statement) }
        for e in l2 where e.kind == .qBank3 { XCTAssertEqual(e.blanks.count, 3); XCTAssertEqual(e.options.count, 5) }
        XCTAssertEqual(SessionBuilder.letterHint("Any fool can criticize,"), "A__ f___ c__ c________,")
    }

    func testPracticeUsesDueCardsAcrossProjects() throws {
        var lib = try sampleLibrary()
        let now = Date()
        for i in lib.cards.indices where i % 3 == 0 {
            lib.cards[i].srs.state = "review"; lib.cards[i].srs.due = ISO.string(now.addingTimeInterval(-3600))
        }
        var rng = SeededRNG(seed: 1)
        let ex = SessionBuilder.practice(cards: lib.cards, profile: lib.profile, now: now, rng: &rng)
        XCTAssertEqual(ex.count, 12)
        XCTAssertGreaterThanOrEqual(Set(ex.compactMap { id in lib.cards.first { $0.id == id.cardId }?.projectId }).count, 2)
        XCTAssertTrue(ex.allSatisfy { [.mc, .bank, .type, .qBank3, .qLetters, .tf, .qBank1].contains($0.kind) })
    }

    // MARK: Lesson titles (spec 4.5), parity with web/src/engine/titles.test.ts

    static let seneca = [
        "It is not that we have a short time to live, but that we waste a lot of it. Life is long enough, and a sufficiently generous amount has been given to us for the highest achievements if it were all well invested. But when it is wasted in heedless luxury and spent on no good activity, we are forced at last by death's final constraint to realize that it has passed away before we knew it was passing. So it is: we are not given a short life but we make it short, and we are not ill-supplied but wasteful of it. Just as when ample and princely wealth falls to a bad owner it is squandered in a moment, but wealth however modest, if entrusted to a good custodian, increases with use, so our lifetime extends amply if you manage it properly.",
        "People are frugal in guarding their personal property; but as soon as it comes to squandering time they are most wasteful of the one thing in which it is right to be stingy. Nothing is more certain than that the busy man is least occupied with living. There is nothing which is harder to learn. Learning how to live takes a whole life, and, which may surprise you more, it takes a whole life to learn how to die. Putting things off is the biggest waste of life: it snatches away each day as it comes, and denies us the present by promising the future. The greatest obstacle to living is expectancy, which hangs upon tomorrow and loses today.",
        "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary. I wanted to live deep and suck out all the marrow of life. Our life is frittered away by detail. An honest man has hardly need to count more than his ten fingers. Simplicity, simplicity, simplicity! I say, let your affairs be as two or three, and not a hundred or a thousand.",
    ]

    func testTitlesPreferRepeatedPhrase() {
        let pages = [
            Page(id: "a", kind: "screenshot", text: "Guard your personal property as carefully as your hours each and every morning. Thieves rarely take personal property from people who keep careful lists of what they own."),
            Page(id: "b", kind: "screenshot", text: "Wasted time never returns to anyone who spends it carelessly on trivial errands. Count your wasted time honestly at the end of every single working week."),
        ]
        let r = LessonBuilder.build(pages: pages, title: "Test")
        XCTAssertEqual(r.lessons.count, 1)
        XCTAssertTrue(["Personal Property", "Wasted Time"].contains(r.lessons[0].title), r.lessons[0].title)
    }

    func testSenecaTitlesMatchWeb() {
        let pages = Self.seneca.enumerated().map { i, t in Page(id: "p\(i)", kind: "screenshot", text: t, header: i < 2 ? "On the Shortness of Life" : "Walden") }
        let t1 = LessonBuilder.build(pages: pages, title: "On the Shortness of Life").lessons.map(\.title)
        let t2 = LessonBuilder.build(pages: pages, title: "On the Shortness of Life").lessons.map(\.title)
        XCTAssertEqual(t1, t2)
        XCTAssertFalse(t1.contains("Short & Time"))
        XCTAssertFalse(t1.contains("Learn & Life"))
        for t in t1 {
            let parts = t.lowercased().components(separatedBy: " ").filter { $0 != "&" }
            XCTAssertFalse(parts.allSatisfy { LessonBuilder.weakTitleWords.contains($0) }, t)
        }
        XCTAssertEqual(t1, ["Waste & Deep", "Detail & Frittered"])
    }
}

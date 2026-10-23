import XCTest

/// Whole-page questions and the mixed multiple choice (spec 13.7).
final class V9Tests: XCTestCase {
    static let pages: [(String, String, [String])] = [
        ("p1", "l1", ["Sleep helps the brain store what you learned today.", "During deep sleep the brain replays new memories.", "Pulling an all nighter makes memories from the day fade."]),
        ("p2", "l1", ["Caffeine blocks the signal that tells you to feel sleepy.", "A coffee after lunch can still keep you awake at night.", "Your body clears caffeine slowly over many hours."]),
        ("p3", "l2", ["Morning light sets your body clock for the whole day.", "Screens at night trick the brain into thinking it is daytime.", "A steady wake up time makes falling asleep easier."]),
    ]
    let cards: [Card] = {
        var n = 0
        return V9Tests.pages.flatMap { page, lesson, lines in
            lines.map { s -> Card in
                defer { n += 1 }
                return Card(id: "c\(n)", lessonId: lesson, projectId: "p", pageId: page, kind: "fact", statement: s,
                            cloze: String(s.split(separator: " ")[1]), distractors: ["one", "two", "three"], falseStatement: "\(s) Not.")
            }
        }
    }()
    let lesson = Lesson(id: "l1", projectId: "p", title: "Sleep", summary: "", kind: "theme", order: 0)

    func on(_ page: String, _ s: String) -> Bool { V9Tests.pages.first { $0.0 == page }!.2.contains(s) }

    func testPageMatesInPoolOrder() {
        XCTAssertEqual(SessionBuilder.pageMates(cards[0], pool: cards).map(\.id), ["c1", "c2"])
        var lone = cards[0]; lone.pageId = nil
        XCTAssertTrue(SessionBuilder.pageMates(lone, pool: cards).isEmpty)
    }

    func testGistAsksForTheMainPoint() throws {
        var rng = SeededRNG(seed: 1)
        let e = try XCTUnwrap(SessionBuilder.pageMC(cards[0], pool: cards, form: .gist, rng: &rng))
        XCTAssertEqual(e.form, "gist")
        XCTAssertEqual(e.body, "What's the main point of the page these lines come from?")
        XCTAssertTrue(on("p1", e.answer))
        XCTAssertEqual(e.context.count, 2)
        XCTAssertFalse(e.context.contains(e.answer))
        XCTAssertEqual(e.options.filter { on("p1", $0) }, [e.answer])
        // Other lessons first: all wrong answers come from p3.
        XCTAssertEqual(e.options.filter { on("p3", $0) }.count, 3)
    }

    func testOddHasOneOutsiderAsTheAnswer() throws {
        var rng = SeededRNG(seed: 1)
        let e = try XCTUnwrap(SessionBuilder.pageMC(cards[3], pool: cards, form: .odd, rng: &rng))
        XCTAssertEqual(e.options.filter { on("p2", $0) }.count, 3)
        XCTAssertFalse(on("p2", e.answer))
        XCTAssertTrue(e.options.contains(e.answer))
    }

    func testMateShowsOneLine() throws {
        var rng = SeededRNG(seed: 1)
        let e = try XCTUnwrap(SessionBuilder.pageMC(cards[6], pool: cards, form: .mate, rng: &rng))
        XCTAssertEqual(e.context, [cards[6].statement])
        XCTAssertEqual(e.answer, cards[7].statement)
        XCTAssertEqual(e.options.filter { on("p3", $0) }, [e.answer])
    }

    func testFormFailsWithoutMates() {
        var rng = SeededRNG(seed: 1)
        var lone = cards[0]; lone.id = "x"; lone.pageId = "solo"
        XCTAssertNil(SessionBuilder.pageMC(lone, pool: cards + [lone], form: .mate, rng: &rng))
    }

    func testLessonWithoutConceptsHasNoBlanksAndMixesForms() {
        var profile = Profile(); profile.practice = ["tap"]
        var forms = Set<String>()
        for seed in 1..<8 {
            var rng = SeededRNG(seed: UInt64(seed))
            var l = lesson; l.level = 2
            let ex = SessionBuilder.build(lesson: l, cards: cards, projectCards: cards, profile: profile, rng: &rng)
            XCTAssertFalse(ex.contains { $0.body.contains("____") }, "seed \(seed)")
            let mcs = ex.filter { $0.kind == .mc }
            forms.formUnion(mcs.compactMap(\.form))
            let keys = mcs.filter { $0.form == "gist" || $0.form == "odd" }.map { e in "\(e.form!):\(cards.first { $0.id == e.cardId }!.pageId!)" }
            XCTAssertEqual(Set(keys).count, keys.count)
        }
        XCTAssertEqual(forms, ["gist", "odd", "mate"])
    }

    func testConceptAndPageQuestionsTakeTurns() {
        let mixed = cards.enumerated().map { i, c -> Card in
            guard i % 3 == 0, c.lessonId == "l1" else { return c }
            var c = c; c.concept = "Sleep"; c.question = "Why \(i)?"; c.answer = "Because \(i)"; c.distractors = ["Nope a", "Nope b", "Nope c"]
            return c
        }
        var profile = Profile(); profile.practice = ["tap"]
        var rng = SeededRNG(seed: 5)
        let forms = SessionBuilder.build(lesson: lesson, cards: mixed, projectCards: mixed, profile: profile, rng: &rng).filter { $0.kind == .mc }.compactMap(\.form)
        XCTAssertEqual(forms.first, "concept")
        XCTAssertTrue(forms.contains("gist"))
    }

    func testPracticeHasNoBankOrTyping() {
        let due = cards.map { c -> Card in var c = c; c.srs = Srs(state: "review", ease: 2.5, interval: 3, due: "2026-10-01T00:00:00.000Z", reps: 2, lapses: 0); return c }
        for seed in 1..<6 {
            var rng = SeededRNG(seed: UInt64(seed))
            let kinds = SessionBuilder.practice(cards: due, profile: Profile(), rng: &rng).map(\.kind)
            XCTAssertTrue(kinds.allSatisfy { $0 == .mc || $0 == .tf }, "\(kinds)")
        }
    }

    func testWriterGetsPagesAndPageIds() {
        var lib = Library()
        lib.lessons = [lesson]
        lib.cards = cards
        lib.pages = [Page(id: "p1", projectId: "p", kind: "screenshot", text: String(repeating: "x", count: 2000))]
        XCTAssertEqual(WrittenConcepts.writerInput(lib, lessonId: "l1")[0], WriterCard(id: "c0", text: cards[0].statement, pageId: "p1"))
        XCTAssertEqual(WrittenConcepts.writerPages(lib, lessonId: "l1"), [WriterPage(id: "p1", text: String(repeating: "x", count: 1200))])
    }
}

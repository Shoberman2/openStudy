import XCTest

/// Whole-page questions (spec 13.7) and the majority multiple choice mix (spec 13.8).
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
        XCTAssertEqual(e.body, "These lines come from one page. Which idea goes with them?")
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

    func testFormFailsWithoutMates() {
        var rng = SeededRNG(seed: 1)
        var lone = cards[0]; lone.id = "x"; lone.pageId = "solo"
        XCTAssertNil(SessionBuilder.pageMC(lone, pool: cards + [lone], form: .odd, rng: &rng))
    }

    static let habits = [
        "Habits are the compound interest of self-improvement. The same way that money multiplies through compound interest, the effects of your habits multiply as you repeat them. They seem to make little difference on any given day and yet the impact they deliver over the months and years can be enormous.",
        "You do not rise to the level of your goals. You fall to the level of your systems. Goals are about the results you want to achieve. Systems are about the processes that lead to those results. If you want better results, then forget about setting goals. Focus on your system instead.",
        "The most effective way to change your habits is to focus not on what you want to achieve, but on who you wish to become. Your identity emerges out of your habits. Every action you take is a vote for the type of person you wish to become.",
        "Environment is the invisible hand that shapes human behavior. People often choose products not because of what they are, but because of where they are. If you want to make a habit a big part of your life, make the cue a big part of your environment.",
        "The two-minute rule states that when you start a new habit, it should take less than two minutes to do. A new habit should not feel like a challenge. The point is to master the habit of showing up, because a habit must be established before it can be improved.",
        "We are more likely to repeat a behavior when the experience is satisfying. The first three laws of behavior change increase the odds that a behavior will be performed this time. The fourth law increases the odds that it will be repeated next time.",
    ]

    func testSlotPlanIsMostlyMultipleChoice() {
        for level in [0, 2, 4] {
            var rng = SeededRNG(seed: UInt64(level + 1))
            let plan = SessionBuilder.slotPlan(level: level, length: 10, apply: true, match: false, rng: &rng)
            XCTAssertEqual(plan.filter { $0 == .m }.count, 6)
            XCTAssertEqual(plan[0], .m)
            XCTAssertEqual(plan.filter { $0 == .bank || $0 == .type }.count, 2)
        }
        var rng = SeededRNG(seed: 1)
        XCTAssertTrue(SessionBuilder.slotPlan(level: 4, length: 10, apply: true, match: false, rng: &rng).contains(.apply))
        XCTAssertTrue(SessionBuilder.slotPlan(level: 0, length: 10, apply: false, match: true, rng: &rng).contains(.match))
    }

    func testKeyBlanks() {
        func mk(_ id: String, _ s: String, _ cloze: String? = nil) -> Card { Card(id: id, lessonId: "l1", projectId: "p", kind: "fact", statement: s, cloze: cloze) }
        let pool = [
            mk("a", "Compound interest makes small habits grow over many years.", "years"),
            mk("b", "Your habits shape your identity over time.", "identity"),
            mk("c", "Compound interest rewards patience with money."),
            mk("d", "Identity comes from repeated actions."),
            mk("e", "People want results without systems."),
            mk("f", "Results come from systems people build."),
            mk("g", "Earth is a planet and habits matter here and habits stay."),
        ] + (0..<4).map { mk("z\($0)", "Unrelated filler sentence number \($0) about gardens.") }
        let blanks = SessionBuilder.KeyBlanks(pool: pool)
        XCTAssertEqual(blanks.word(pool[0]), "habits")
        XCTAssertEqual(blanks.word(pool[1]), "identity")
        XCTAssertTrue(["results", "systems", "Results"].contains(blanks.word(pool[4]) ?? ""))
        XCTAssertNil(blanks.word(pool[6]))
        let wrong = blanks.wrong(pool[1], word: "identity", count: 3)
        XCTAssertEqual(wrong.count, 3)
        XCTAssertFalse(wrong.contains { pool[1].statement.lowercased().contains($0) })
    }

    func testRealLessonsAreMostlyMultipleChoice() {
        let pages = V9Tests.habits.enumerated().map { Page(id: "h\($0.offset)", projectId: "p", kind: "screenshot", text: $0.element) }
        var lib = Library()
        lib.pages = pages
        let p = lib.createProject(title: "Atomic Habits", author: nil, pageIds: pages.map(\.id), build: LessonFactory.build(pages: pages, title: "Atomic Habits", author: nil, type: "book"), focus: "ideas", quotes: nil)
        let all = lib.cards(ofProject: p.id)
        var profile = Profile(); profile.practice = ["tap"]; profile.goals = ["ideas", "apply"]
        var mc = 0, fill = 0, total = 0
        for l in lib.lessons(of: p.id) where !l.isQuotes {
            for level in [0, 2, 4] {
                for seed in 1..<4 {
                    var rng = SeededRNG(seed: UInt64(seed))
                    var lesson = l; lesson.level = level
                    let ex = SessionBuilder.build(lesson: lesson, cards: lib.cards(of: l.id), projectCards: all, profile: profile, rng: &rng)
                    total += ex.count
                    mc += ex.filter { $0.kind == .mc || $0.kind == .defMc }.count
                    fill += ex.filter { [.bank, .type, .termType].contains($0.kind) }.count
                    for e in ex where e.kind == .tf { XCTAssertTrue(all.first { $0.id == e.cardId }!.isConcept) }
                }
            }
        }
        XCTAssertGreaterThan(total, 0)
        XCTAssertGreaterThanOrEqual(Double(mc) / Double(total), 0.55)
        XCTAssertGreaterThanOrEqual(Double(fill) / Double(total), 0.1)
    }

    func testPracticeIsMostlyMultipleChoice() {
        let due = cards.map { c -> Card in var c = c; c.srs = Srs(state: "review", ease: 2.5, interval: 3, due: "2026-10-01T00:00:00.000Z", reps: 2, lapses: 0); return c }
        for seed in 1..<6 {
            var rng = SeededRNG(seed: UInt64(seed))
            let ex = SessionBuilder.practice(cards: due, profile: Profile(), rng: &rng)
            XCTAssertTrue(ex.allSatisfy { $0.kind == .mc || $0.kind == .bank }, "\(ex.map(\.kind))")
            XCTAssertGreaterThan(ex.filter { $0.kind == .mc }.count * 2, ex.count)
        }
    }

    func testConceptRulesSkipTheRejectedHalf() {
        XCTAssertNil(Concepts.question("People often choose products not because of what they are, but because of where they are."))
        XCTAssertNil(Concepts.question("The most effective way to change your habits is to focus not on what you want to achieve, but on who you wish to become."))
        XCTAssertNil(Concepts.question("Systems are about the processes that lead to those results."))
        let m = Concepts.question("If you want better results, then forget about setting goals.")
        XCTAssertEqual(m?.question, "If you want better results, then what?")
        XCTAssertEqual(m?.answer, "Forget about setting goals")
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

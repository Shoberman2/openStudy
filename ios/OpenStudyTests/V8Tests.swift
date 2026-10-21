import XCTest

/// Written concept questions and the concept-only theme mix (spec 13.4, 13.6).
final class V8Tests: XCTestCase {
    func card(_ id: String, lesson: String = "l", term: String? = nil, kind: String = "fact", concept: String? = nil) -> Card {
        Card(id: id, lessonId: lesson, projectId: "p", kind: kind, statement: "Fact \(id) mentions word\(id) here.", cloze: "word\(id)",
             question: concept == nil ? "Fact \(id) mentions ____ here." : "Why does \(id) matter?", answer: concept == nil ? "word\(id)" : "It helps",
             distractors: ["alpha", "beta", "gamma"], falseStatement: "Fact \(id) mentions alpha here.",
             term: term, definition: term == nil ? nil : "a definition", concept: concept)
    }

    func library(_ cards: [Card], kind: String = "theme") -> Library {
        var lib = Library()
        lib.projects = [Project(id: "p", title: "Book", color: .blue)]
        lib.lessons = [Lesson(id: "l", projectId: "p", title: "Sleep", summary: "", kind: kind, order: 0)]
        lib.cards = cards
        return lib
    }

    func written(_ id: String, distractors: [String] = ["Less rest", "More noise", "Bad moods"]) -> WrittenConcept {
        WrittenConcept(id: id, concept: "Sleep debt", question: "What does missing sleep lead to?", answer: "Poor focus",
                       distractors: distractors, falseStatement: "Missing sleep has no effect.")
    }

    // MARK: Apply (13.6)

    func testApplyKeepsIdsAndSrs() {
        var a = card("a"); a.srs = Srs(state: "review", ease: 2.2, interval: 3, due: "2026-01-01T00:00:00.000Z", reps: 2, lapses: 1)
        let lib = library([a, card("b")])
        let now = ISO.date("2026-02-01T00:00:00.000Z")!
        let out = WrittenConcepts.applyWrittenConcepts(lib, lessonId: "l", written: [written("a"), written("a", distractors: ["X", "Y", "Z"])], source: "device", now: now)
        let c = out.cards.first { $0.id == "a" }!
        XCTAssertEqual(out.cards.map(\.id), ["a", "b"])
        XCTAssertEqual(c.srs, a.srs)
        XCTAssertEqual(c.concept, "Sleep debt")
        XCTAssertEqual(c.question, "What does missing sleep lead to?")
        XCTAssertEqual(c.answer, "Poor focus")
        XCTAssertEqual(c.distractors, ["Less rest", "More noise", "Bad moods"], "a returned id is used once")
        XCTAssertEqual(c.falseStatement, "Missing sleep has no effect.")
        XCTAssertTrue(c.isConcept)
        XCTAssertEqual(out.cards.first { $0.id == "b" }, lib.cards[1])
        XCTAssertEqual(out.lessons[0].conceptsWritten, true)
        XCTAssertEqual(out.events.last?.name, "questions_written")
        XCTAssertEqual(out.events.last?.props?["source"], .string("device"))
        XCTAssertEqual(out.events.last?.props?["count"], .number(1))
        XCTAssertEqual(out.events.last?.props?["lessonId"], .string("l"))
        XCTAssertEqual(out.events.last?.t, ISO.string(now))
    }

    func testApplyRejectsWeakCardsAndUnknownIds() {
        let lib = library([card("a"), card("b"), card("c"), card("t", term: "Term")])
        let out = WrittenConcepts.applyWrittenConcepts(lib, lessonId: "l", written: [
            written("a", distractors: ["Less rest", "less rest!", "Poor focus", "Bad moods"]), // 2 distinct, one equals the answer
            written("b", distractors: ["Less rest", "More noise"]),
            written("zzz"),
            written("t"), // a definition card is not writer input
            WrittenConcept(id: "c", question: " ", answer: "Poor focus", distractors: ["A b", "C d", "E f"]),
        ], source: "server")
        XCTAssertEqual(out.cards, lib.cards)
        XCTAssertEqual(out.events.last?.props?["count"], .number(0))
        XCTAssertEqual(out.lessons[0].conceptsWritten, true)
    }

    func testApplyDedupesDistractorsBeforeTheCheck() {
        let lib = library([card("a")])
        let out = WrittenConcepts.applyWrittenConcepts(lib, lessonId: "l", written: [written("a", distractors: ["Less rest", "The less rest", "More noise", "Bad moods"])], source: "device")
        XCTAssertEqual(out.cards[0].distractors, ["Less rest", "More noise", "Bad moods"])
    }

    func testEmptyResultStillMarksTheLesson() {
        let lib = library([card("a")])
        let out = WrittenConcepts.applyWrittenConcepts(lib, lessonId: "l", written: [], source: "none")
        XCTAssertEqual(out.cards, lib.cards)
        XCTAssertEqual(out.lessons[0].conceptsWritten, true)
        XCTAssertEqual(out.events.last?.props?["source"], .string("none"))
        XCTAssertEqual(out.events.last?.props?["count"], .number(0))
        XCTAssertFalse(WrittenConcepts.needsWrittenConcepts(out, lessonId: "l"))
    }

    // MARK: Trigger and input (13.6)

    func testNeedsWrittenConcepts() {
        XCTAssertTrue(WrittenConcepts.needsWrittenConcepts(library([card("a"), card("b")]), lessonId: "l"))
        // Half or more concept cards: no.
        XCTAssertFalse(WrittenConcepts.needsWrittenConcepts(library([card("a", concept: "Sleep"), card("b")]), lessonId: "l"))
        XCTAssertTrue(WrittenConcepts.needsWrittenConcepts(library([card("a", concept: "Sleep"), card("b"), card("c")]), lessonId: "l"))
        // Word lessons (every card has a term) and quotes: no.
        XCTAssertFalse(WrittenConcepts.needsWrittenConcepts(library([card("a", term: "A"), card("b", term: "B")]), lessonId: "l"))
        XCTAssertFalse(WrittenConcepts.needsWrittenConcepts(library([card("a", kind: "quote")], kind: "quotes"), lessonId: "l"))
        // Definition cards do not count toward the half.
        XCTAssertTrue(WrittenConcepts.needsWrittenConcepts(library([card("a", term: "A"), card("b", term: "B"), card("c")]), lessonId: "l"))
        // Already written, unknown lesson, or only pictures: no.
        var done = library([card("a")]); done.lessons[0].conceptsWritten = true
        XCTAssertFalse(WrittenConcepts.needsWrittenConcepts(done, lessonId: "l"))
        XCTAssertFalse(WrittenConcepts.needsWrittenConcepts(library([card("a")]), lessonId: "nope"))
        XCTAssertFalse(WrittenConcepts.needsWrittenConcepts(library([card("a", kind: "picture")]), lessonId: "l"))
    }

    func testWriterInputIsFactCardsOnlyAtMost14() {
        let cards = (0..<20).map { card("f\($0)") } + [card("t", term: "T"), card("pic", kind: "picture"), card("o", lesson: "other")]
        let input = WrittenConcepts.writerInput(library(cards), lessonId: "l")
        XCTAssertEqual(input.count, 14)
        XCTAssertEqual(input.map(\.id), (0..<14).map { "f\($0)" })
        XCTAssertEqual(input[0].text, cards[0].statement)
    }

    func testLessonDecodesWithoutConceptsWritten() throws {
        let json = #"{"id":"l","projectId":"p","title":"Old","summary":"","kind":"theme","order":0,"level":0,"sessions":0}"#
        var l = try JSONDecoder().decode(Lesson.self, from: Data(json.utf8))
        XCTAssertNil(l.conceptsWritten)
        XCTAssertFalse(String(data: try JSONEncoder().encode(l), encoding: .utf8)!.contains("conceptsWritten"))
        l.conceptsWritten = true
        XCTAssertTrue(String(data: try JSONEncoder().encode(l), encoding: .utf8)!.contains("\"conceptsWritten\":true"))
    }

    // MARK: Theme mix (13.4)

    func testThemeSessionsHaveNoBankMatchOrType() {
        let cards = (0..<6).map { card("f\($0)") } + (0..<3).map { card("c\($0)", concept: "Sleep") }
        for level in 0...5 {
            var lesson = Lesson(id: "l", projectId: "p", title: "Sleep", summary: "", order: 0)
            lesson.level = level
            for practice in [["tap"], ["blank"], ["type"], ["tap", "blank", "type"]] {
                var profile = Profile(); profile.practice = practice; profile.goals = ["ideas", "apply"]
                for seed in 1...8 as ClosedRange<UInt64> {
                    var rng = SeededRNG(seed: seed)
                    let ex = SessionBuilder.build(lesson: lesson, cards: cards, profile: profile, rng: &rng)
                    XCTAssertEqual(ex.count, 10)
                    XCTAssertFalse(ex.contains { [.bank, .match, .type, .termType].contains($0.kind) }, "level \(level): \(ex.map(\.kind))")
                    XCTAssertFalse([.explain, .apply].contains(ex.first!.kind))
                    XCTAssertLessThanOrEqual(ex.filter { $0.kind == .explain || $0.kind == .apply }.count, 1)
                }
            }
        }
    }

    func testTfSlotsTakeConceptCardsFirst() {
        let lesson = Lesson(id: "l", projectId: "p", title: "Sleep", summary: "", order: 0)
        let cards = (0..<6).map { card("f\($0)") } + (0..<4).map { card("c\($0)", concept: "Sleep") }
        var profile = Profile(); profile.practice = ["tap"]
        for seed in 1...10 as ClosedRange<UInt64> {
            var rng = SeededRNG(seed: seed)
            let ex = SessionBuilder.build(lesson: lesson, cards: cards, profile: profile, rng: &rng)
            // The first 4 mc or tf exercises use each concept card once.
            let first = ex.filter { $0.kind == .mc || $0.kind == .tf }.prefix(4).map(\.cardId)
            XCTAssertTrue(first.allSatisfy { $0.hasPrefix("c") }, "\(ex.map { ($0.kind, $0.cardId) })")
            XCTAssertEqual(Set(first).count, 4)
        }
    }
}

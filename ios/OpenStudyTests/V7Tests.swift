import XCTest

/// Concept questions and choosing a focus (spec 13).
final class V7Tests: XCTestCase {
    func fact(_ statement: String, term: String? = nil) -> BuiltCard {
        BuiltCard(pageId: "p1", statement: statement, cloze: "x", question: statement, answer: "x",
                  distractors: ["a", "b", "c"], falseStatement: statement, term: term, definition: term == nil ? nil : "a definition here")
    }

    // MARK: Patterns (13.3)

    func testWhyPattern() {
        let m = Concepts.question("Most people waste their time because they never plan their day.")
        XCTAssertEqual(m?.question, "Most people waste their time. Why?")
        XCTAssertEqual(m?.answer, "They never plan their day")
        XCTAssertEqual(Concepts.question("Athletes stretch before games, so that they avoid injury.")?.question, "Athletes stretch before games. Why?")
        // A needs 3..16 words.
        XCTAssertNil(Concepts.question("Rest because tired muscles heal."))
    }

    func testEffectPattern() {
        let m = Concepts.question("Stress causes poor sleep in adults.")
        XCTAssertEqual(m?.question, "What does stress cause?")
        XCTAssertEqual(m?.answer, "Poor sleep in adults")
        let plural = Concepts.question("Short naps improve memory and mood.")
        XCTAssertEqual(plural?.question, "What do short naps improve?")
        XCTAssertEqual(plural?.answer, "Memory and mood")
        XCTAssertEqual(Concepts.question("Daily practice leads to lasting skill.")?.question, "What does daily practice lead to?")
        // All-capital first words keep their case.
        XCTAssertEqual(Concepts.question("DNA controls how cells grow.")?.question, "What does DNA control?")
        XCTAssertEqual(Concepts.lowerFirst("McDonald farms"), "McDonald farms")
        XCTAssertEqual(Concepts.lowerFirst("Sleep debt"), "sleep debt")
        // No comma in A, B needs 2..12 words.
        XCTAssertNil(Concepts.question("Sadly, stress causes poor sleep."))
        XCTAssertNil(Concepts.question("Stress causes insomnia."))
    }

    func testPronounSkip() {
        XCTAssertNil(Concepts.question("It causes poor sleep in adults."))
        XCTAssertNil(Concepts.question("They waste their whole day because nobody plans it."))
        XCTAssertNil(Concepts.question("This leads to better habits over time."))
    }

    func testNewRules() {
        func q(_ s: String) -> [String]? { Concepts.question(s).map { [$0.question, $0.answer] } }
        XCTAssertEqual(q("Instead of condemning people, let's try to understand them."), ["What should you do instead of condemning people?", "Let's try to understand them"])
        XCTAssertEqual(q("Ask questions instead of giving direct orders."), ["What should you do instead of giving direct orders?", "Ask questions"])
        XCTAssertEqual(q("Loss is nothing else but change, and change is Nature's delight."), ["What is loss?", "Nothing else but change"])
        XCTAssertNil(q("Nucleus: holds the cell's DNA and controls its activity."))
        XCTAssertEqual(q("If you are wrong, admit it quickly and emphatically."), ["If you are wrong, then what?", "Admit it quickly and emphatically"])
        XCTAssertEqual(q("The key to winning people is to show real interest; nothing else works."), ["What is the key to winning people?", "To show real interest"])
    }

    func testSampleBookParity() throws {
        let url = try XCTUnwrap(Bundle(for: V7Tests.self).url(forResource: "sample-library", withExtension: "json"))
        let lib = try Library.decode(Data(contentsOf: url))
        let p = try XCTUnwrap(lib.project("smpcarnegi"))
        let r = LessonFactory.build(pages: lib.pages.filter { $0.projectId == p.id }, title: p.title, author: p.author, type: p.kind)
        let concepts = r.lessons.flatMap(\.cards).filter { $0.concept != nil }
        XCTAssertEqual(concepts.count, 7, "\(concepts.map { [$0.question, $0.answer] })")
        XCTAssertTrue(concepts.contains { $0.question == "What is the deepest urge in human nature?" && $0.answer == "The desire to be important" })
        XCTAssertTrue(concepts.contains { $0.question == "If you are wrong, then what?" && $0.answer == "Admit it quickly and emphatically" })
        for c in concepts { XCTAssertEqual(c.distractors.count, 3); XCTAssertLessThanOrEqual(TextKit.wordCount(c.question), 15) }
    }

    // MARK: Project pass (13.3)

    let matching = [
        "Stress causes poor sleep in adults.",
        "Short naps improve memory and mood.",
        "Most people waste their time because they never plan their day.",
        "Daily practice leads to lasting skill.",
        "Exercise reduces the risk of heart disease.",
    ]

    func testNeedsFourMatchesInTheProject() {
        let three = BuildResult(lessons: [BuiltLesson(title: "Sleep", summary: "", cards: matching.prefix(3).map { fact($0) } + [fact("Plain sentence with no pattern at all.")])], quotes: [])
        XCTAssertEqual(Concepts.apply(three), three)
        // Four across two lessons is enough; definition cards never count.
        let four = BuildResult(lessons: [
            BuiltLesson(title: "Sleep", summary: "", cards: matching.prefix(2).map { fact($0) } + [fact("Caffeine causes restless nights for many.", term: "Caffeine")]),
            BuiltLesson(title: "Habits", summary: "", cards: matching[2...3].map { fact($0) }),
        ], quotes: [])
        let r = Concepts.apply(four)
        XCTAssertEqual(r.lessons[0].cards[0].question, "What does stress cause?")
        XCTAssertEqual(r.lessons[0].cards[0].concept, "Sleep")
        XCTAssertEqual(r.lessons[1].cards[0].concept, "Habits")
        XCTAssertEqual(r.lessons[0].cards[0].cloze, "x", "cloze stays")
        XCTAssertNil(r.lessons[0].cards[2].concept)
        XCTAssertEqual(r.lessons[0].cards[2].question, "Caffeine causes restless nights for many.")
    }

    func testDistractorsClosestInWordCount() {
        let r = Concepts.apply(BuildResult(lessons: [BuiltLesson(title: "Health", summary: "", cards: matching.map { fact($0) })], quotes: []))
        let cards = r.lessons[0].cards
        // Answers: "Poor sleep in adults"(4), "Memory and mood"(3), "They never plan their day"(5), "Lasting skill"(2), "The risk of heart disease"(5).
        XCTAssertEqual(cards[0].distractors, ["Memory and mood", "They never plan their day", "The risk of heart disease"])
        XCTAssertEqual(cards[3].distractors, ["Memory and mood", "Poor sleep in adults", "They never plan their day"])
        for c in cards { XCTAssertFalse(c.distractors.contains(c.answer)); XCTAssertEqual(c.distractors.count, 3) }
        // Answers contained in the statement or equal to its own are skipped; fewer than 3 left = unchanged.
        let dup = ["Stress causes poor sleep in adults.", "Worry causes poor sleep in adults.", "Noise causes poor sleep in adults.",
                   "Light causes poor sleep in adults.", "Short naps improve memory and mood."]
        let d = Concepts.apply(BuildResult(lessons: [BuiltLesson(title: "Sleep", summary: "", cards: dup.map { fact($0) })], quotes: []))
        XCTAssertNil(d.lessons[0].cards[0].concept)
        XCTAssertNil(d.lessons[0].cards[4].concept)
    }

    func testMaterializeCopiesConcept() {
        var lib = Library()
        let r = Concepts.apply(BuildResult(lessons: [BuiltLesson(title: "Health", summary: "", cards: matching.map { fact($0) })], quotes: []))
        lib.createProject(title: "Health", author: nil, pageIds: [], build: r, focus: "ideas", quotes: nil)
        XCTAssertEqual(lib.cards.filter(\.isConcept).count, 5)
        let data = try! lib.encoded()
        XCTAssertTrue(String(data: data, encoding: .utf8)!.contains("\"concept\":\"Health\""))
        XCTAssertEqual(try Library.decode(data).cards.first?.concept, "Health")
    }

    // MARK: Focus (13.5)

    func focusLibrary() -> Library {
        var lib = Library()
        lib.projects = [Project(id: "p", title: "Book", color: .blue)]
        lib.lessons = [
            Lesson(id: "a", projectId: "p", title: "A", summary: "", order: 0),
            Lesson(id: "q", projectId: "p", title: "Quotes", summary: "", kind: "quotes", order: 1),
            Lesson(id: "b", projectId: "p", title: "B", summary: "", order: 2),
            Lesson(id: "c", projectId: "p", title: "C", summary: "", order: 3),
            Lesson(id: "d", projectId: "p", title: "D", summary: "", order: 4),
        ]
        return lib
    }

    func testSetFocusReordersWithQuotes() {
        var lib = focusLibrary()
        lib.setFocus(projectId: "p", lessonIds: ["d", "c", "q", "zzz"])
        XCTAssertEqual(lib.lessons(of: "p").map(\.id), ["c", "q", "d", "a", "b"])
        XCTAssertEqual(lib.lessons(of: "p").map(\.order), [0, 1, 2, 3, 4])
        XCTAssertEqual(lib.project("p")?.focusLessons, ["c", "d"], "path order, theme lessons only")
        XCTAssertEqual(lib.project("p")?.focusAsked, true)
        XCTAssertEqual(lib.events.last?.name, "focus_set")
        XCTAssertEqual(lib.events.last?.props?["offered"], .number(4))
        XCTAssertEqual(lib.events.last?.props?["chosen"], .number(2))
        // Everything keeps the current order.
        lib.setFocus(projectId: "p", lessonIds: [])
        XCTAssertEqual(lib.lessons(of: "p").map(\.id), ["c", "q", "d", "a", "b"])
        XCTAssertEqual(lib.project("p")?.focusLessons, [])
        XCTAssertEqual(lib.events.last?.props?["chosen"], .number(0))
    }

    func testOldProjectsDecodeWithoutFocus() throws {
        let json = #"{"id":"p","title":"Old","color":"red","createdAt":"2026-01-01T00:00:00.000Z","focus":"ideas","quotesAsked":true}"#
        let p = try JSONDecoder().decode(Project.self, from: Data(json.utf8))
        XCTAssertNil(p.focusLessons); XCTAssertNil(p.focusAsked)
        var q = p; q.focusLessons = ["x"]; q.focusAsked = true
        let out = String(data: try JSONEncoder().encode(q), encoding: .utf8)!
        XCTAssertTrue(out.contains("\"focusLessons\":[\"x\"]") && out.contains("\"focusAsked\":true"))
    }

    // MARK: Session mix (13.4)

    func testMixes() {
        XCTAssertEqual(SessionBuilder.themeMix(level: 0), [.mc, .tf, .mc])
        XCTAssertEqual(SessionBuilder.themeMix(level: 1), [.mc, .tf, .mc])
        XCTAssertEqual(SessionBuilder.themeMix(level: 2), [.mc, .tf, .explain])
        XCTAssertEqual(SessionBuilder.themeMix(level: 3), [.mc, .tf, .explain])
        XCTAssertEqual(SessionBuilder.themeMix(level: 4), [.mc, .tf, .explain, .apply])
        XCTAssertEqual(SessionBuilder.classMix(level: 0), [.defMc, .mc, .tf])
        XCTAssertEqual(SessionBuilder.classMix(level: 1), [.defMc, .mc, .tf])
        XCTAssertEqual(SessionBuilder.classMix(level: 3), [.termType, .mc, .explain])
        XCTAssertEqual(SessionBuilder.classMix(level: 4), [.termType, .mc, .tf, .explain])
    }

    func testMcPrefersConceptCards() {
        let lesson = Lesson(id: "l", projectId: "p", title: "Sleep", summary: "", order: 0)
        var cards: [Card] = (0..<6).map { i in
            Card(id: "f\(i)", lessonId: "l", projectId: "p", kind: "fact", statement: "Fact number \(i) mentions word\(i) here.", cloze: "word\(i)",
                 question: "Fact number \(i) mentions ____ here.", answer: "word\(i)", distractors: ["alpha", "beta", "gamma"], falseStatement: "Fact number \(i) mentions alpha here.")
        }
        cards += (0..<5).map { i in
            Card(id: "c\(i)", lessonId: "l", projectId: "p", kind: "fact", statement: "Thing \(i) causes effect \(i) in people.", cloze: "effect",
                 question: "What does thing \(i) cause?", answer: "Effect \(i) in people", distractors: ["One", "Two", "Three"],
                 falseStatement: "Thing \(i) causes nothing.", concept: "Sleep")
        }
        var profile = Profile(); profile.practice = ["tap"]; profile.goals = ["ideas"]
        for seed in 1...5 as ClosedRange<UInt64> {
            var rng = SeededRNG(seed: seed)
            let ex = SessionBuilder.build(lesson: lesson, cards: cards, profile: profile, rng: &rng)
            XCTAssertEqual(ex.count, 10)
            let mc = ex.filter { $0.kind == .mc }
            XCTAssertFalse(mc.isEmpty)
            // The first mc and tf slots each take a concept card not used yet in this session; then the normal pick.
            let firstMc = ex.filter { $0.kind == .mc || $0.kind == .tf }.prefix(5).map(\.cardId)
            XCTAssertTrue(firstMc.allSatisfy { $0.hasPrefix("c") }, "\(ex.map { ($0.kind, $0.cardId) })")
            XCTAssertEqual(Set(firstMc).count, firstMc.count)
            XCTAssertEqual(mc.first.map { $0.cardId.hasPrefix("c") ? $0.body.hasPrefix("What does thing") : true }, true)
            XCTAssertGreaterThanOrEqual(SessionBuilder.conceptCount(ex, cards: cards), 5)
        }
    }

    func testTrueFalseOnConceptCards() {
        let c = Card(id: "c", lessonId: "l", projectId: "p", kind: "fact", statement: "Stress causes poor sleep in adults.", cloze: "sleep",
                     question: "What does stress cause?", answer: "Poor sleep in adults. ", distractors: ["Memory and mood", "B", "C"],
                     falseStatement: "Stress causes poor memory in adults.", concept: "Sleep")
        var sawTrue = false, sawFalse = false
        for seed in 1...20 as ClosedRange<UInt64> {
            var rng = SeededRNG(seed: seed)
            let e = SessionBuilder.make(.tf, card: c, extraWords: [], rng: &rng)
            XCTAssertEqual(e.hint, "What does stress cause? Poor sleep in adults.")
            if e.tfIsTrue { sawTrue = true; XCTAssertEqual(e.body, "What does stress cause? Poor sleep in adults."); XCTAssertEqual(e.answer, "True") }
            else { sawFalse = true; XCTAssertEqual(e.body, "What does stress cause? Memory and mood."); XCTAssertEqual(e.answer, "False") }
        }
        XCTAssertTrue(sawTrue && sawFalse)
        // A plain fact card still uses its cloze swap.
        var fact = c; fact.concept = nil
        var rng = SeededRNG(seed: 1)
        let f = SessionBuilder.make(.tf, card: fact, extraWords: [], rng: &rng)
        XCTAssertTrue([fact.statement, fact.falseStatement!].contains(f.body))
    }

    func testExplainAndApplyShareOneSlot() {
        var lesson = Lesson(id: "l", projectId: "p", title: "Sleep", summary: "", order: 0)
        lesson.level = 4
        let cards: [Card] = (0..<10).map { i in
            Card(id: "f\(i)", lessonId: "l", projectId: "p", kind: "fact", statement: "Fact number \(i) mentions word\(i) here.", cloze: "word\(i)",
                 question: "Fact number \(i) mentions ____ here.", answer: "word\(i)", distractors: ["alpha", "beta", "gamma"])
        }
        var profile = Profile(); profile.goals = ["apply"]
        for seed in 1...10 as ClosedRange<UInt64> {
            var rng = SeededRNG(seed: seed)
            let ex = SessionBuilder.build(lesson: lesson, cards: cards, profile: profile, rng: &rng)
            XCTAssertLessThanOrEqual(ex.filter { $0.kind == .explain || $0.kind == .apply }.count, 1)
        }
    }
}

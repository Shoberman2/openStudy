import CoreGraphics
import XCTest

/// Runs every case in shared/fixtures/v4-cases.json (spec section 10), plus iOS engine checks.
final class V4Tests: XCTestCase {
    let now = ISO.date("2026-10-19T12:00:00.000Z")!

    func cases() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: V4Tests.self).url(forResource: "v4-cases", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    func list(_ key: String) throws -> [Any] { try XCTUnwrap(try cases()[key] as? [Any]) }
    func str(_ v: Any?) -> String? { v as? String }

    // MARK: Fixture cases

    func testWordLists() throws {
        for case let c as [String: Any] in try list("wordLists") {
            let text = c["text"] as! String
            let r = WordList.parse(text, title: str(c["title"]))
            XCTAssertEqual(r.isWordList, c["isWordList"] as? Bool, text)
            if let words = c["words"] as? [[String: Any]] {
                XCTAssertEqual(r.words, words.map { WordEntry(term: $0["term"] as! String, definition: $0["definition"] as? String) }, text)
            }
        }
    }

    func testTitlesMatch() throws {
        for case let c as [Any] in try list("titlesMatch") {
            XCTAssertEqual(Identity.titlesMatch(c[0] as! String, c[1] as! String), c[2] as? Bool, "\(c[0]) vs \(c[1])")
        }
    }

    func testSameAuthor() throws {
        for case let c as [Any] in try list("sameAuthor") {
            XCTAssertEqual(Identity.sameAuthor(c[0] as? String, c[1] as? String), c[2] as? Bool, "\(c[0]) vs \(c[1])")
        }
    }

    func testPageNumbers() throws {
        for case let c as [String: Any] in try list("pageNumber") {
            let n = PageNumbers.fromLines(footer: c["footer"] as! [String], header: c["header"] as! [String])
            XCTAssertEqual(n, c["n"] as? Int, "\(c)")
        }
    }

    func testDHashAndHamming() throws {
        for case let c as [String: Any] in try list("dHash") {
            let px = (c["pixels"] as! [NSNumber]).map(\.doubleValue)
            XCTAssertEqual(ImageHash.dHash(pixels: px), c["hash"] as? String)
        }
        for case let c as [Any] in try list("hamming") {
            XCTAssertEqual(ImageHash.hamming(c[0] as! String, c[1] as! String), (c[2] as? Int) ?? Int.max, "\(c)")
        }
    }

    func testDetectionSummary() throws {
        for case let c as [String: Any] in try list("detectionSummary") {
            let groups = (c["groups"] as! [[String: Any]]).map { g in
                SuggestedGroup(title: g["title"] as! String, pageIds: (0..<(g["pages"] as! Int)).map { _ in IDGen.make() }, type: g["type"] as! String)
            }
            XCTAssertEqual(Grouper.detectionSummary(groups), c["line"] as? String)
        }
    }

    func testIsVerbatim() throws {
        for case let c as [Any] in try list("isVerbatim") {
            XCTAssertEqual(AskEngine.isVerbatim(c[0] as! String, in: c[1] as! String), c[2] as? Bool, "\(c[0])")
        }
    }

    func testRetrieve() throws {
        let c = try XCTUnwrap(try cases()["retrieve"] as? [String: Any])
        let pages = (c["pages"] as! [[String: String]]).map { Page(id: $0["id"]!, kind: "note", text: $0["text"]!) }
        XCTAssertEqual(AskEngine.retrieve(c["question"] as! String, pages: pages).map(\.page.id), c["top"] as? [String])
    }

    func testConnections() throws {
        let c = try XCTUnwrap(try cases()["connections"] as? [String: Any])
        let lessons = (c["lessons"] as! [[String: Any]]).map {
            ConnectionLesson(id: $0["id"] as! String, projectId: $0["projectId"] as! String, title: $0["title"] as! String, statements: $0["statements"] as! [String])
        }
        let got = Connections.find(lessons)
        let want = c["expect"] as! [[String: [String]]]
        XCTAssertEqual(got.map(\.projects), want.map { $0["projects"]! })
        XCTAssertEqual(got.map(\.lessons), want.map { $0["lessons"]! })
        XCTAssertEqual(got.map(\.terms), want.map { $0["terms"]! })
    }

    // MARK: Word lists end to end

    func vocabNote() -> AppleNote {
        AppleNote(id: "x-coredata://w1", title: "Words I didn't know", folder: "Reading",
                  text: "Words I didn't know\nephemeral - lasting a very short time\nlaconic: using very few words\nobsequious - too eager to please\nsonder")
    }

    func testVocabNoteBecomesOneWordPageAndWordsGroup() throws {
        let ps = AppleNotes.pages(vocabNote(), now: now)
        XCTAssertEqual(ps.count, 1)
        XCTAssertEqual(ps[0].heading, "Words")
        XCTAssertEqual(ps[0].words?.map(\.term), ["ephemeral", "laconic", "obsequious", "sonder"])
        let pasted = NotesParser.pages(from: "My vocab words:\nzeal: great energy\ncandor: honesty")
        let groups = Grouper.group(ps + pasted)
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].title, "Words")
        XCTAssertEqual(groups[0].type, "other")
        XCTAssertEqual(groups[0].category, "Vocabulary")
        XCTAssertEqual(groups[0].pageIds.count, 2)
    }

    func testWordLessonsChunkByTwelveWithDefinitionCards() {
        let entries = (1...14).map { WordEntry(term: "term\(String(UnicodeScalar(96 + $0)!))", definition: "meaning number \($0) here") }
        let page = Page(kind: "note", text: "x", heading: "Words", words: entries + [WordEntry(term: "undefined")])
        let r = LessonFactory.build(pages: [page], title: "Words", author: nil, type: "other")
        XCTAssertEqual(r.lessons.map(\.title), ["Terma to Terml", "Termm to Termn"])
        XCTAssertEqual(r.lessons.map(\.cards.count), [12, 2])
        let c = r.lessons[0].cards[0]
        XCTAssertEqual(c.term, "terma")
        XCTAssertEqual(c.question, "What is terma?")
        XCTAssertEqual(c.distractors.count, 3)
    }

    func testWordsToDefineAddsCard() {
        var lib = Library()
        let page = Page(kind: "note", text: "x", heading: "Words", words: [WordEntry(term: "zeal", definition: "great energy"), WordEntry(term: "sonder")])
        lib.pages = [page]
        let build = LessonFactory.build(pages: [page], title: "Words", author: nil, type: "other")
        let p = lib.createProject(title: "Words", author: nil, pageIds: [page.id], build: build, focus: "ideas", quotes: nil, type: "other")
        XCTAssertEqual(lib.undefinedWords(of: p.id).map(\.term), ["sonder"])
        lib.defineWord(pageId: page.id, term: "sonder", definition: "the feeling that every stranger has a full life")
        XCTAssertTrue(lib.undefinedWords(of: p.id).isEmpty)
        XCTAssertEqual(lib.lessons(of: p.id).count, 1)
        XCTAssertEqual(lib.cards(ofProject: p.id).compactMap(\.term), ["zeal", "sonder"])
        XCTAssertTrue(SessionBuilder.usesClassMix(projectIsClass: false, cards: lib.cards(ofProject: p.id)))
    }

    // MARK: Same book merge (10.4)

    func testBookTitlesMergeAcrossSpellings() {
        let a = (1...3).map { Page(kind: "note", text: "Habits are the compound interest of self improvement number \($0).", suggestedTitle: "Atomic Habits", suggestedAuthor: "James Clear") }
        let b = Page(kind: "note", text: "Every action you take is a vote for the type of person you wish to become.", suggestedTitle: "Atomic Habits: An Easy and Proven Way", suggestedAuthor: "Clear, James")
        let c = Page(kind: "note", text: "The impediment to action advances action.", suggestedTitle: "Meditations", suggestedAuthor: "Marcus Aurelius")
        let groups = Grouper.group(a + [b, c])
        let habits = groups.first { $0.title == "Atomic Habits" }
        XCTAssertEqual(habits?.pageIds.count, 4)
        XCTAssertEqual(habits?.author, "James Clear")
        // Same normalized title is one key already; different spellings with conflicting authors stay apart.
        let e = Page(kind: "note", text: "x y z", suggestedTitle: "The Meditations", suggestedAuthor: "Someone Else")
        XCTAssertEqual(Grouper.group([c, e]).count, 2)
        XCTAssertEqual(Grouper.group([Page(kind: "note", text: "Cells", suggestedTitle: "BIO 101"), Page(kind: "note", text: "Cells", suggestedTitle: "BIO 102")]).count, 2)
    }

    // MARK: Duplicates (10.3)

    func testDuplicatesByTextAndImageHash() {
        let text = "Habits are the compound interest of self improvement and they add up over the years."
        var ix = DuplicateIndex([Page(kind: "note", text: text)])
        XCTAssertTrue(ix.isDuplicate(Page(kind: "screenshot", text: "  Habits are the compound interest of self-improvement, and they add up over the years! ")))
        let shot = Page(kind: "screenshot", text: "The first page of a book about habits and the systems behind them.", imageHash: "aa00000000000000")
        XCTAssertFalse(ix.isDuplicate(shot))
        // Same look, different page of the same book: not a duplicate.
        XCTAssertFalse(ix.isDuplicate(Page(kind: "screenshot", text: "Chapter two talks about identity, votes and becoming a new person.", imageHash: "aa00000000000001")))
        // Same look and mostly the same words (OCR noise): duplicate.
        XCTAssertTrue(ix.isDuplicate(Page(kind: "screenshot", text: "The first page of a book about habits and the systems behind them", imageHash: "ab00000000000000")))
        XCTAssertTrue(ix.isDuplicate(Page(kind: "photo", text: "Hi", imageHash: "0000000000000000")) == false)
        XCTAssertTrue(ix.isDuplicate(Page(kind: "photo", text: "Hi there", imageHash: "0000000000000001")))
    }

    func testDHashOfImage() throws {
        // Left half white, right half black: every row is 8 bits of left > right only at the edge.
        let w = 90, h = 80
        var px = [UInt8](repeating: 0, count: w * h * 4)
        for y in 0..<h { for x in 0..<w { let v: UInt8 = x < w / 2 ? 255 : 0; let i = (y * w + x) * 4; px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255 } }
        let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        let img = try XCTUnwrap(ctx.makeImage())
        let hash = try XCTUnwrap(ImageHash.dHash(img))
        XCTAssertEqual(hash.count, 16)
        XCTAssertEqual(Set(stride(from: 0, to: 16, by: 2).map { Array(hash)[$0...$0 + 1] }).count, 1)
        XCTAssertNotEqual(hash, "0000000000000000")
    }

    // MARK: Page order (10.5)

    func testScreenshotsOrderByPageNumber() {
        let p3 = Page(kind: "screenshot", text: "c", createdAt: "2026-10-01T10:00:00.000Z", pageNumber: 3)
        let p1 = Page(kind: "screenshot", text: "a", createdAt: "2026-10-01T10:01:00.000Z", pageNumber: 1)
        let none = Page(kind: "screenshot", text: "?", createdAt: "2026-10-01T09:00:00.000Z")
        let p2 = Page(kind: "screenshot", text: "b", createdAt: "2026-10-01T10:02:00.000Z", pageNumber: 2)
        XCTAssertEqual(PageNumbers.ordered([p3, none, p1, p2]).map(\.text), ["a", "b", "c", "?"])
        // Under half numbered: left alone.
        XCTAssertEqual(PageNumbers.ordered([p3, none, Page(kind: "screenshot", text: "x"), Page(kind: "screenshot", text: "y")]).map(\.text), ["c", "?", "x", "y"])
    }

    func testCleanerReadsPageNumberFromFooter() {
        let lines = [OCRLine(text: "Atomic Habits", top: 0.03, bottom: 0.05),
                     OCRLine(text: String(repeating: "Habits are the compound interest of self improvement. ", count: 6), top: 0.2, bottom: 0.25),
                     OCRLine(text: "47", top: 0.95, bottom: 0.97)]
        XCTAssertEqual(ScreenshotCleaner.clean(lines).pageNumber, 47)
    }

    // MARK: Ask (10.7)

    func testLocalAnswerQuotesTheClosestSentences() {
        let a = Page(kind: "note", text: "The Krebs cycle runs in the mitochondria of the cell. It produces NADH and some ATP for the cell. Glycolysis happens in the cytoplasm first.")
        let b = Page(kind: "note", text: "Stoics say virtue is the only good and the rest is indifferent to a wise person.")
        let qs = AskEngine.localAnswer("Where does the Krebs cycle run?", pages: [a, b])
        XCTAssertFalse(qs.isEmpty)
        XCTAssertEqual(qs[0].text, "The Krebs cycle runs in the mitochondria of the cell.")
        XCTAssertTrue(qs.allSatisfy { $0.pageId == a.id })
        XCTAssertTrue(AskEngine.localAnswer("quantum chromodynamics", pages: [a, b]).isEmpty)
    }

    func testPracticeBothInterleaves() {
        func card(_ l: String, _ s: String) -> Card { Card(lessonId: l, projectId: l, kind: "fact", statement: s, cloze: "habits", question: "____", answer: "habits", distractors: ["a", "b", "c"], falseStatement: s) }
        let a = (1...3).map { card("A", "Small habits compound \($0).") }
        let b = (1...3).map { card("B", "Daily habits of reflection \($0).") }
        var rng = SeededRNG(seed: 4)
        let ex = SessionBuilder.connection(a, b, profile: Profile(), rng: &rng)
        XCTAssertEqual(ex.count, 10)
        XCTAssertEqual(ex.prefix(4).map(\.cardIds[0]), [a[0].id, b[0].id, a[1].id, b[1].id])
    }

    // MARK: Spec 10.10

    func testDefinitionCardsAskForTheTerm() {
        let c = Card(lessonId: "L", projectId: "P", kind: "fact", statement: "Zeal: great energy.", cloze: "Zeal", question: "What is Zeal?", answer: "Zeal",
                     distractors: ["Candor", "Sonder", "Ennui"], falseStatement: "Zeal: honesty.", term: "Zeal", definition: "great energy")
        var rng = SeededRNG(seed: 1)
        for kind in [ExerciseKind.mc, .type, .flash] {
            let e = SessionBuilder.make(kind, card: c, extraWords: [], rng: &rng)
            XCTAssertEqual(e.body, "Which term means: great energy?", "\(kind)")
            XCTAssertEqual(e.answer, "Zeal")
        }
    }

    func testSavingADefinitionRetitlesTheWordLesson() {
        var lib = Library()
        let page = Page(kind: "note", text: "x", heading: "Words", words: [WordEntry(term: "zeal", definition: "great energy"), WordEntry(term: "candor", definition: "honesty"), WordEntry(term: "sonder")])
        lib.pages = [page]
        let p = lib.createProject(title: "Words", author: nil, pageIds: [page.id], build: LessonFactory.build(pages: [page], title: "Words", author: nil, type: "other"), focus: "ideas", quotes: nil, type: "other")
        XCTAssertEqual(lib.lessons(of: p.id).map(\.title), ["Zeal to Candor"])
        XCTAssertEqual(lib.lessons(of: p.id).map(\.summary), ["2 words from your list."])
        lib.defineWord(pageId: page.id, term: "sonder", definition: "the feeling that every stranger has a full life")
        XCTAssertEqual(lib.lessons(of: p.id).map(\.title), ["Zeal to Sonder"])
        XCTAssertEqual(lib.lessons(of: p.id).map(\.summary), ["3 words from your list."])
    }

    func testSampleProjectsCountOnlyWithFewerThanTwoRealOnes() {
        let s1 = Project(id: "s1", title: "Sample", color: .blue, sample: true)
        let r1 = Project(id: "r1", title: "Mine", color: .red)
        let r2 = Project(id: "r2", title: "Also mine", color: .green)
        XCTAssertEqual(Library.scopeProjects([s1, r1]), ["s1", "r1"])
        XCTAssertEqual(Library.scopeProjects([s1, r1, r2]), ["r1", "r2"])
        // Connections between a sample and one real project.
        var lib = Library()
        lib.projects = [s1, r1]
        lib.lessons = [Lesson(id: "L1", projectId: "s1", title: "Habits", summary: "", order: 0), Lesson(id: "L2", projectId: "r1", title: "Discipline", summary: "", order: 0)]
        lib.cards = [Card(lessonId: "L1", projectId: "s1", kind: "fact", statement: "Small habits compound into remarkable results over years."),
                     Card(lessonId: "L2", projectId: "r1", kind: "fact", statement: "Daily habits of reflection build discipline over years.")]
        XCTAssertEqual(lib.connections().map(\.lessons), [["L1", "L2"]])
        lib.projects.append(r2)
        XCTAssertTrue(lib.connections().isEmpty)
    }

    func testLocalAnswerFallsBackToTheTopPage() {
        let p = Page(kind: "note", text: "Krebs cycle: mitochondria")
        XCTAssertEqual(AskEngine.localAnswer("Krebs cycle", pages: [p]).map(\.text), ["Krebs cycle: mitochondria"])
    }
}

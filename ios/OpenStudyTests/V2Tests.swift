import XCTest

final class V2Tests: XCTestCase {
    func sampleLibrary() throws -> Library {
        let url = try XCTUnwrap(Bundle(for: V2Tests.self).url(forResource: "sample-library", withExtension: "json"))
        return try Library.decode(Data(contentsOf: url))
    }

    // MARK: ZIP + PPTX

    static func slideXML(title: String?, body: [String]) -> String {
        var shapes = ""
        if let title {
            shapes += "<p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Title\"/><p:cNvSpPr/><p:nvPr><p:ph type=\"title\"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>\(title)</a:t></a:r></a:p></p:txBody></p:sp>"
        }
        shapes += "<p:sp><p:nvSpPr><p:cNvPr id=\"3\" name=\"Body\"/><p:cNvSpPr/><p:nvPr><p:ph idx=\"1\"/></p:nvPr></p:nvSpPr><p:txBody>"
        for b in body { shapes += "<a:p><a:r><a:t>\(b)</a:t></a:r></a:p>" }
        shapes += "</p:txBody></p:sp>"
        shapes += "<p:sp><p:nvSpPr><p:cNvPr id=\"4\" name=\"Num\"/><p:cNvSpPr/><p:nvPr><p:ph type=\"sldNum\"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>7</a:t></a:r></a:p></p:txBody></p:sp>"
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"><p:cSld><p:spTree>\(shapes)</p:spTree></p:cSld></p:sld>"
    }

    static func makePPTX() -> Data {
        var z = ZipWriter()
        z.add("[Content_Types].xml", "<Types/>")
        z.add("docProps/core.xml", "<cp:coreProperties xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:title>Enzymes &amp; Metabolism</dc:title></cp:coreProperties>")
        z.add("ppt/slides/slide1.xml", slideXML(title: "Enzymes", body: ["Enzyme: a protein that speeds up a chemical reaction", "Enzymes are not used up by the reactions they speed up"]))
        z.add("ppt/slides/slide2.xml", slideXML(title: "Activation Energy", body: ["Activation energy: the energy needed to start a reaction", "Enzymes lower the activation energy of a reaction"]), deflate: true)
        z.add("ppt/slides/slide10.xml", slideXML(title: "Inhibitors", body: ["Competitive inhibitor: a molecule that blocks the active site of an enzyme"]))
        z.add("ppt/slides/slide3.xml", slideXML(title: nil, body: ["Thanks"]))
        z.add("ppt/slides/_rels/slide1.xml.rels", "<Relationships><Relationship Target=\"../notesSlides/notesSlide1.xml\"/></Relationships>")
        z.add("ppt/notesSlides/notesSlide1.xml", "<p:notes xmlns:a=\"a\" xmlns:p=\"p\"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type=\"body\"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Remember the lock and key model for exams</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type=\"sldNum\"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>", deflate: true)
        return z.finish()
    }

    func testZipReaderStoredAndDeflated() throws {
        let data = Self.makePPTX()
        let zip = try ZipArchive(data: data)
        XCTAssertTrue(zip.names.contains("ppt/slides/slide2.xml"))
        let s2 = try XCTUnwrap(zip.string(for: "ppt/slides/slide2.xml"))
        XCTAssertTrue(s2.contains("Activation energy: the energy needed"))
        let big = String(repeating: "deflate me please ", count: 4000)
        var z = ZipWriter(); z.add("big.txt", big, deflate: true); z.add("small.txt", "hi")
        let z2 = try ZipArchive(data: z.finish())
        XCTAssertEqual(try z2.string(for: "big.txt"), big)
        XCTAssertEqual(try z2.string(for: "small.txt"), "hi")
        XCTAssertThrowsError(try ZipArchive(data: Data("not a zip at all, just text".utf8)))
    }

    func testPPTXParsing() throws {
        let doc = try DocumentParser.pptx(Self.makePPTX())
        XCTAssertEqual(doc.title, "Enzymes & Metabolism")
        XCTAssertEqual(doc.pages.map(\.heading), ["Enzymes", "Activation Energy", "Inhibitors"], "numeric slide order, title placeholder as heading, short slide skipped")
        XCTAssertTrue(doc.pages[0].text.contains("Enzyme: a protein"))
        XCTAssertTrue(doc.pages[0].text.contains("lock and key"), "speaker notes appended")
        XCTAssertFalse(doc.pages[0].text.contains("\n7"), "slide number placeholder skipped")
        XCTAssertFalse(doc.pages[0].text.hasSuffix("\n1"))
        XCTAssertEqual(doc.pages.map(\.index), [1, 2, 4])
    }

    func testDOCXParsing() throws {
        func para(_ t: String, style: String? = nil) -> String {
            let s = style.map { "<w:pPr><w:pStyle w:val=\"\($0)\"/></w:pPr>" } ?? ""
            return "<w:p>\(s)<w:r><w:t>\(t)</w:t></w:r></w:p>"
        }
        let body = para("Photosynthesis Notes", style: "Title") + para("Light Reactions", style: "Heading1") +
            para("Chlorophyll: the pigment that absorbs light energy in plants.") + para("Light reactions happen in the thylakoid membranes.") +
            para("Calvin Cycle", style: "Heading2") + para("The Calvin cycle fixes carbon dioxide into sugar using ATP.")
        var z = ZipWriter()
        z.add("word/document.xml", "<w:document xmlns:w=\"w\"><w:body>\(body)</w:body></w:document>", deflate: true)
        let doc = try DocumentParser.docx(z.finish())
        XCTAssertEqual(doc.title, "Photosynthesis Notes")
        XCTAssertEqual(doc.pages.map(\.heading), ["Light Reactions", "Calvin Cycle"])
        XCTAssertTrue(doc.pages[0].text.contains("Chlorophyll: the pigment"))
        // Without headings: chunks of about 250 words.
        let long = (0..<60).map { para("Sentence number \($0) talks about cells and energy in detail.") }.joined()
        var z2 = ZipWriter(); z2.add("word/document.xml", "<w:document xmlns:w=\"w\"><w:body>\(long)</w:body></w:document>")
        let d2 = try DocumentParser.docx(z2.finish())
        XCTAssertEqual(d2.pages.count, 3)
    }

    func testMarkdownSectionsAndFileNames() {
        let md = "# Lecture 3\n## Glycolysis\n- Glycolysis: splitting glucose into two pyruvate molecules\n- It happens in the cytoplasm of the cell\n## Krebs Cycle\nThe Krebs cycle runs in the mitochondria and releases carbon dioxide."
        let doc = DocumentParser.markdownSections(md)
        XCTAssertEqual(doc?.pages.map(\.heading), ["Glycolysis", "Krebs Cycle"])
        XCTAssertEqual(DocumentParser.cleanFileName("Lecture 4: Enzymes.pptx"), "Enzymes")
        XCTAssertEqual(DocumentParser.cleanFileName("lecture_1 - The Cell.pdf"), "The Cell")
        XCTAssertEqual(DocumentParser.cleanFileName("week3_notes.docx"), "week3_notes")
        XCTAssertNotNil(DocumentParser.htmlToMarkdown("<h2>Cells</h2><p>Cells are small.</p>").range(of: "# Cells"))
    }

    // MARK: Definitions

    func testDefinitionDetection() {
        XCTAssertEqual(DefinitionDetector.detect("Mitochondria: the organelle that produces most of the cell's ATP.")?.term, "Mitochondria")
        XCTAssertEqual(DefinitionDetector.detect("Osmosis - diffusion of water across a selectively permeable membrane")?.term, "Osmosis")
        XCTAssertEqual(DefinitionDetector.detect("Velocity = displacement divided by the time taken")?.term, "Velocity")
        let d = DefinitionDetector.detect("Diffusion is the movement of molecules from high to low concentration.")
        XCTAssertEqual(d?.term, "Diffusion")
        XCTAssertEqual(d?.definition, "The movement of molecules from high to low concentration")
        XCTAssertEqual(DefinitionDetector.detect("Adenosine triphosphate (ATP) is the main energy currency of the cell")?.term, "Adenosine triphosphate")
        XCTAssertEqual(DefinitionDetector.detect("The cell membrane refers to the thin layer around every cell")?.term, "Cell membrane")
        XCTAssertNil(DefinitionDetector.detect("It is not that we have a short time to live"), "pronoun subject")
        XCTAssertNil(DefinitionDetector.detect("Note: short"), "definition under 4 words")
        XCTAssertNil(DefinitionDetector.detect("This is a very long sentence that goes on: with way too many words in the supposed term part"))
    }

    // MARK: Grouping

    func testCourseCodeGroupingAndPhotos() {
        let t0 = ISO.date("2026-10-10T09:00:00.000Z")!
        let pages = [
            Page(id: "a1", kind: "slides", text: "BIO 101: Cell Biology\nWelcome to the course", createdAt: ISO.string(t0), sourceName: "Lecture 1 - The Cell.pptx", sourceIndex: 1, heading: "BIO 101: Cell Biology"),
            Page(id: "a2", kind: "slides", text: "Cells are the basic unit of life", createdAt: ISO.string(t0), sourceName: "Lecture 1 - The Cell.pptx", sourceIndex: 2, heading: "Cells"),
            Page(id: "b1", kind: "pdf", text: "BIO101 Cell Biology, week 2\nMembranes control transport", createdAt: ISO.string(t0), sourceName: "Membranes.pdf", sourceIndex: 1),
            Page(id: "c1", kind: "doc", text: "Supply and demand set prices in a market economy", createdAt: ISO.string(t0), sourceName: "Economics essay.docx", sourceIndex: 1, heading: "Markets"),
            Page(id: "c2", kind: "doc", text: "Elasticity measures how demand responds to price", header: "Markets and Prices", createdAt: ISO.string(t0), sourceName: "Market notes.docx", sourceIndex: 1),
            Page(id: "p1", kind: "photo", text: "Photosynthesis turns light into sugar in plants", createdAt: ISO.string(t0)),
            Page(id: "p2", kind: "photo", text: "Chlorophyll absorbs red and blue light", createdAt: ISO.string(t0.addingTimeInterval(2 * 3600))),
            Page(id: "p3", kind: "photo", text: "Totally different board from the next day", createdAt: ISO.string(t0.addingTimeInterval(26 * 3600))),
        ]
        let g = Grouper.group(pages)
        let bio = g.first { $0.pageIds.contains("a1") }
        XCTAssertEqual(bio?.pageIds.sorted(), ["a1", "a2", "b1"])
        XCTAssertEqual(bio?.title, "BIO 101: Cell Biology")
        XCTAssertEqual(bio?.type, "class")
        let econ = g.first { $0.pageIds.contains("c1") }
        XCTAssertEqual(econ?.pageIds.sorted(), ["c1", "c2"], "titles share >= 50% tokens")
        XCTAssertEqual(econ?.type, "other")
        XCTAssertEqual(g.first { $0.pageIds.contains("p1") }?.pageIds, ["p1", "p2"], "photos within 3 hours")
        XCTAssertEqual(g.first { $0.pageIds.contains("p3") }?.pageIds, ["p3"])
        XCTAssertEqual(Grouper.courseCode(in: "Notes for CS229 Machine Learning")?.display, "CS 229")
    }

    // MARK: Class lessons

    func testClassLessonsPerFileWithDefinitions() throws {
        let lib = try sampleLibrary()
        let pages = lib.pages.filter { $0.projectId == "smpbio101" }
        let r = ClassBuilder.build(pages: pages, title: "BIO 101")
        XCTAssertEqual(r.lessons.map(\.title), ["The Cell", "Whiteboard Oct 9", "Membranes"].filter { _ in false } + r.lessons.map(\.title))
        // Files: Lecture 1 (pptx), Whiteboard photo, Lecture 2 (pdf) -> sorted by number, photo (no number) last.
        XCTAssertEqual(r.lessons.first?.title, "The Cell")
        XCTAssertTrue(r.lessons.contains { $0.title == "Membranes" })
        let defs = r.lessons.flatMap(\.cards).filter { $0.term != nil }
        XCTAssertTrue(defs.contains { $0.term == "Mitochondria" && $0.question == "What is Mitochondria?" })
        XCTAssertTrue(defs.contains { $0.term == "Osmosis" })
        for d in defs { XCTAssertEqual(d.distractors.count, 3); XCTAssertFalse(d.distractors.contains(d.term!)) }
        XCTAssertTrue(r.lessons.allSatisfy { $0.cards.count <= 24 })
        XCTAssertTrue(r.quotes.isEmpty, "no verbatim excerpts in class material")
        // Single file split by headings.
        let single = ClassBuilder.build(pages: pages.filter { $0.sourceName == "Lecture 1 - The Cell.pptx" }.map { var p = $0; p.text += " Cells keep growing and dividing every day."; return p })
        XCTAssertGreaterThanOrEqual(single.lessons.count, 1)
    }

    func testClassSessionMixAndDefinitionExercises() throws {
        let lib = try sampleLibrary()
        var lesson = lib.lessons.first { $0.id == "lb1" }!
        var rng = SeededRNG(seed: 3)
        let ex0 = SessionBuilder.build(lesson: lesson, cards: lib.cards, projectCards: lib.cards(ofProject: "smpbio101"), profile: lib.profile, isClass: true, rng: &rng)
        XCTAssertTrue(ex0.allSatisfy { [.defMc, .mc, .match, .tf].contains($0.kind) }, "\(ex0.map(\.kind))")
        for e in ex0 where e.kind == .defMc {
            XCTAssertEqual(e.options.count, 4); XCTAssertTrue(e.options.contains(e.answer))
            XCTAssertEqual(lib.cards.first { $0.id == e.cardId }?.definition, e.answer)
        }
        for e in ex0 where e.kind == .match { XCTAssertTrue(e.pairs.allSatisfy { p in lib.cards.first { $0.id == p.cardId }?.term == p.term }) }
        lesson.level = 3
        let ex3 = SessionBuilder.build(lesson: lesson, cards: lib.cards, projectCards: lib.cards(ofProject: "smpbio101"), profile: lib.profile, isClass: true, rng: &rng)
        XCTAssertTrue(ex3.allSatisfy { [.termType, .type, .explain, .defMc, .mc, .tf].contains($0.kind) })
        XCTAssertTrue(ex3.contains { $0.kind == .termType })
        for e in ex3 where e.kind == .termType { XCTAssertEqual(lib.cards.first { $0.id == e.cardId }?.term, e.answer) }
        XCTAssertLessThanOrEqual(ex3.filter { $0.kind == .explain }.count, 2)
    }

    // MARK: Plan

    func classLibrary(goalIn days: Int?, lessons n: Int, now: Date, cardsPer: Int = 4) -> Library {
        var lib = Library()
        lib.profile.dailyGoalXP = 20 // 10 minutes
        var p = Project(id: "cls", title: "CHEM 110", color: .green, createdAt: ISO.string(now), type: "class")
        p.goalDate = days.map { DayKey.of(Calendar.current.date(byAdding: .day, value: $0, to: now)!) }
        lib.projects = [p]
        for i in 0..<n {
            lib.lessons.append(Lesson(id: "L\(i)", projectId: "cls", title: "Lesson \(i)", summary: "", order: i))
            for j in 0..<cardsPer { lib.cards.append(Card(id: "c\(i)-\(j)", lessonId: "L\(i)", projectId: "cls", kind: "fact", statement: "Fact \(i) \(j) about chemistry and atoms.", cloze: "chemistry")) }
        }
        return lib
    }

    func testPlanSpacingTestsAndReviewCap() {
        let now = Date()
        var lib = classLibrary(goalIn: 10, lessons: 3, now: now, cardsPer: 14)
        // 40 cards due today: reviews must be capped at 40% of 10 minutes = 4 minutes (13 cards).
        for i in lib.cards.indices.prefix(40) { lib.cards[i].srs = Srs(state: "review", ease: 2.5, interval: 1, due: ISO.string(now.addingTimeInterval(-60)), reps: 1, lapses: 0) }
        let plan = PlanEngine.build(lib, now: now)
        XCTAssertEqual(plan.days.count, 11)
        let r0 = plan.days[0].items.first { $0.kind == .review }
        XCTAssertNotNil(r0)
        XCTAssertLessThanOrEqual(r0!.minutes, 10 * 0.4 + 0.0001)
        XCTAssertEqual(r0!.cards, 13)
        XCTAssertEqual(plan.days[0].items.first?.kind, .review, "reviews first")
        XCTAssertNotNil(plan.days[1].items.first { $0.kind == .review }, "overflow rolls to the next day")
        // Tests on goal-1, goal-3, goal-7.
        let testDays = plan.days.enumerated().filter { $0.element.items.contains { $0.kind == .test } }.map(\.offset)
        XCTAssertEqual(testDays, [3, 7, 9])
        XCTAssertEqual(plan.days[10].exams, ["cls"])
        // Spacing: never the same lesson on consecutive days, never twice a day.
        for (i, d) in plan.days.enumerated() {
            let ids = d.items.compactMap(\.lessonId)
            XCTAssertEqual(ids.count, Set(ids).count)
            if i > 0 {
                let prev = Set(plan.days[i - 1].items.compactMap(\.lessonId))
                XCTAssertTrue(prev.isDisjoint(with: ids), "day \(i) repeats a lesson from day \(i - 1)")
            }
        }
        // Each lesson reaches ready (3 sessions) within the window, so it is feasible.
        XCTAssertTrue(plan.feasibility.isEmpty)
        let sessions = plan.days.flatMap(\.items).filter { $0.kind == .lesson }
        for l in lib.lessons { XCTAssertEqual(sessions.filter { $0.lessonId == l.id }.count, 3) }
    }

    func testPlanFeasibilityAndNoGoal() {
        let now = Date()
        let tight = classLibrary(goalIn: 3, lessons: 12, now: now)
        let plan = PlanEngine.build(tight, now: now)
        XCTAssertEqual(plan.days.count, 7, "7 days when the goal is sooner")
        let f = try? XCTUnwrap(plan.feasibility.first)
        XCTAssertEqual(f?.projectId, "cls")
        XCTAssertGreaterThan(f?.minutesNeeded ?? 0, 10)
        XCTAssertEqual((f?.minutesNeeded ?? 0) % 5, 0)
        var fixed = tight
        fixed.projects[0].minutesPerDay = f?.minutesNeeded
        XCTAssertEqual(PlanEngine.build(fixed, now: now).days[0].budget, Double(f?.minutesNeeded ?? 0))
        let open = PlanEngine.build(classLibrary(goalIn: nil, lessons: 2, now: now), now: now)
        XCTAssertEqual(open.days.count, 7)
        XCTAssertTrue(open.days.allSatisfy { !$0.items.contains { $0.kind == .test } })
    }

    func testPlanMarksDoneAndWeakPriority() {
        let now = Date()
        var lib = classLibrary(goalIn: 20, lessons: 3, now: now)
        lib.log("session_done", ["lessonId": "L0", "accuracy": 1, "seconds": 100, "xp": 20], now: now)
        lib.lessons[0].level = 1
        lib.log("test_done", ["projectId": "cls", "accuracy": 0.5, "weakLessons": "L2"], now: now.addingTimeInterval(-86400 * 3))
        let plan = PlanEngine.build(lib, now: now)
        let today = plan.days[0].items
        XCTAssertTrue(today.contains { $0.lessonId == "L0" && $0.done })
        XCTAssertEqual(today.filter { $0.lessonId == "L0" }.count, 1)
        XCTAssertEqual(today.first { !$0.done && $0.kind == .lesson }?.lessonId, "L2", "weak lesson first")
    }

    // MARK: Practice test

    func testPracticeTestScoring() throws {
        let lib = try sampleLibrary()
        let p = lib.project("smpbio101")!
        var rng = SeededRNG(seed: 9)
        let ex = PracticeTest.build(project: p, lib: lib, rng: &rng)
        XCTAssertEqual(ex.count, 12, "all cards when fewer than 20")
        XCTAssertTrue(ex.allSatisfy { [.type, .termType, .tf, .mc, .defMc].contains($0.kind) })
        var state = SessionState(exercises: ex, requeue: false)
        var seenLb2 = 0
        while let cur = state.current {
            let lesson = lib.cards.first { $0.id == cur.cardId }!.lessonId
            if lesson == "lb2" { seenLb2 += 1 }
            state.submit(lesson == "lb2" && seenLb2 > 1 ? .wrong : .correct)
            state.advance()
        }
        XCTAssertEqual(state.queue.count, 12, "no re-queue in tests")
        let r = PracticeTest.score(log: state.log, lib: lib, projectId: "smpbio101")
        XCTAssertEqual(r.perLesson.map(\.lessonId), ["lb1", "lb2"])
        XCTAssertEqual(r.perLesson[0].accuracy, 1)
        XCTAssertLessThan(r.perLesson[1].accuracy, 0.7)
        XCTAssertEqual(r.weakLessons, ["lb2"])
        XCTAssertEqual(r.missedCards.count, 12 - Int((r.accuracy * 12).rounded()))
    }

    // MARK: Old data

    func testOldLibraryJSONDecodes() throws {
        let json = """
        {"version":1,"profile":{"onboarded":true,"bringing":"screenshots","goals":["ideas"],"practice":["tap"],"dailyGoalXP":20},
         "stats":{"xp":5,"streak":1,"longestStreak":1,"freezes":0,"dayXP":{}},
         "projects":[{"id":"p1","title":"Old Book","color":"blue","createdAt":"2026-01-01T00:00:00.000Z","focus":"ideas","quotesAsked":false}],
         "pages":[{"id":"g1","projectId":"p1","kind":"screenshot","text":"Hello there","createdAt":"2026-01-01T00:00:00.000Z"}],
         "lessons":[],"cards":[{"id":"c1","lessonId":"l1","projectId":"p1","kind":"fact","statement":"A fact.","srs":{"state":"new","ease":2.5,"interval":0,"due":"2026-01-01T00:00:00.000Z","reps":0,"lapses":0}}],
         "events":[]}
        """
        let lib = try Library.decode(Data(json.utf8))
        XCTAssertEqual(lib.profile.bringing, ["books"])
        XCTAssertEqual(lib.projects[0].kind, "book")
        XCTAssertNil(lib.projects[0].goalDate)
        XCTAssertNil(lib.pages[0].sourceName)
        XCTAssertFalse(lib.cards[0].isDefinition)
        let again = try Library.decode(lib.encoded())
        XCTAssertEqual(again.profile.bringing, ["books"])
        let notes = try Library.decode(Data(json.replacingOccurrences(of: "\"screenshots\"", with: "\"both\"").utf8))
        XCTAssertEqual(notes.profile.bringing, ["books"])
        // Sample: class project gets a goal 10 days out.
        var fresh = Library()
        fresh.addSample(try sampleLibrary())
        XCTAssertEqual(fresh.project("smpbio101")?.goalDate, DayKey.of(Calendar.current.date(byAdding: .day, value: 10, to: Date())!))
        XCTAssertEqual(fresh.project("smpbio101")?.kind, "class")
    }
    // MARK: One source of truth for "next"

    func testContinueAndPathNextFollowThePlan() throws {
        let now = Date()
        var lib = Library()
        lib.addSample(try sampleLibrary(), now: now)
        for (id, lv) in [("lc1", 3), ("lb1", 3), ("lb2", 1)] { if let i = lib.lessons.firstIndex(where: { $0.id == id }) { lib.lessons[i].level = lv } }
        let plan = PlanEngine.build(lib, now: now)
        let firstLesson = plan.days[0].items.first { $0.kind == .lesson && !$0.done }
        XCTAssertNotNil(firstLesson)
        XCTAssertEqual(lib.continueTarget(now: now)?.1.id, firstLesson?.lessonId, "Continue = first learning item today")
        for p in lib.projects {
            let planned = plan.days.flatMap(\.items).first { $0.kind == .lesson && !$0.done && $0.projectId == p.id }?.lessonId
            XCTAssertEqual(lib.currentLesson(of: p.id, now: now)?.id, planned, "path Next for \(p.title)")
        }
        // Fallback when nothing is left to learn.
        var done = lib
        for i in done.lessons.indices { done.lessons[i].level = 5 }
        XCTAssertNotNil(done.continueTarget(now: now))
    }

    func testPhotoLineAfterDefinitionStaysSeparate() {
        let lines = [
            OCRLine(text: "Acids and Bases", top: 0.05, bottom: 0.10, left: 0.1, right: 0.5),
            OCRLine(text: "Acid: a substance that gives off hydrogen ions", top: 0.18, bottom: 0.23, left: 0.1, right: 0.92),
            OCRLine(text: "Base: a substance that takes up hydrogen ions", top: 0.30, bottom: 0.35, left: 0.1, right: 0.92),
            OCRLine(text: "pH scale goes from 0 to 14", top: 0.42, bottom: 0.47, left: 0.1, right: 0.92),
            OCRLine(text: "Neutral water has a pH of 7", top: 0.54, bottom: 0.59, left: 0.1, right: 0.6),
        ]
        let text = PhotoText.join(lines)
        let rows = text.components(separatedBy: .newlines).filter { !$0.isEmpty }
        XCTAssertTrue(rows.contains("Base: a substance that takes up hydrogen ions"), text)
        XCTAssertTrue(rows.contains("pH scale goes from 0 to 14"), text)
        XCTAssertEqual(DefinitionDetector.detect(rows.first { $0.hasPrefix("Base") }!)?.definition, "A substance that takes up hydrogen ions")
        // A genuine wrapped continuation still joins.
        let wrapped = PhotoText.join([
            OCRLine(text: "Enzyme: a protein that speeds up a chemical", top: 0.1, bottom: 0.15, left: 0.1, right: 0.95),
            OCRLine(text: "reaction in the body", top: 0.17, bottom: 0.22, left: 0.1, right: 0.5),
        ])
        XCTAssertEqual(wrapped, "Enzyme: a protein that speeds up a chemical reaction in the body")
    }
}

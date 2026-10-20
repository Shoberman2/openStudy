import XCTest

/// Ports web/src/engine/v3.test.ts with identical expected values (spec section 9).
final class V3Tests: XCTestCase {
    let now = ISO.date("2026-10-19T12:00:00.000Z")!

    func fixture() throws -> [AppleNote] {
        let url = try XCTUnwrap(Bundle(for: V3Tests.self).url(forResource: "apple-notes", withExtension: "json"))
        return try XCTUnwrap(NotesExport.decode(Data(contentsOf: url))).notes
    }

    func sample() throws -> Library {
        let url = try XCTUnwrap(Bundle(for: V3Tests.self).url(forResource: "sample-library", withExtension: "json"))
        return try Library.decode(Data(contentsOf: url))
    }

    // MARK: Apple Notes to pages (9.3)

    func testImportsEveryNoteExceptDeletedAndNearEmpty() throws {
        let r = AppleNotes.importNotes(try fixture(), known: [], now: now)
        XCTAssertEqual(r.notes, 11)
        XCTAssertEqual(r.empty, 1)
        XCTAssertEqual(r.pages.count, 15)
        XCTAssertTrue(r.pages.allSatisfy { $0.kind == "note" && $0.projectId == nil && $0.noteId != nil })
        XCTAssertFalse(r.pages.contains { $0.folder == "Recently Deleted" })
        XCTAssertEqual(r.summary, "Added 15 pages from 11 notes.")
    }

    func testSkipsNotesAlreadyInLibrary() throws {
        let r = AppleNotes.importNotes(try fixture(), known: ["x-coredata://n1", "x-coredata://n2"], now: now)
        XCTAssertEqual(r.already, 2)
        XCTAssertEqual(r.notes, 9)
        XCTAssertEqual(r.summary, "Added 12 pages from 9 notes. 2 were already here.")
    }

    func testSplitsAtHeadingsDropsTitleKeepsFolderAndDates() throws {
        let ps = AppleNotes.pages(try fixture()[0], now: now)
        XCTAssertEqual(ps.map(\.heading), ["Atomic Habits by James Clear", "Identity"])
        XCTAssertTrue(ps[0].text.hasPrefix("Habits are the compound interest"))
        XCTAssertTrue(ps[0].text.contains("\n\nYou do not rise"))
        XCTAssertEqual(ps.map(\.sourceIndex), [1, 2])
        XCTAssertEqual(ps[0].folder, "Books")
        XCTAssertEqual(ps[0].createdAt, "2026-09-01T10:00:00.000Z")
    }

    func testBooksExcerptsInsideANote() throws {
        let ps = AppleNotes.pages(try fixture()[11], now: now)
        XCTAssertEqual(ps.count, 2)
        XCTAssertTrue(ps.allSatisfy { $0.verbatim == true && $0.suggestedTitle == "Meditations" && $0.suggestedAuthor == "Marcus Aurelius" })
    }

    func testNoteHtmlToText() {
        XCTAssertEqual(AppleNotes.htmlToText("<div>Title</div><h2>Part</h2><div>One<br>two</div>"), "Title\n\n## Part\n\nOne\ntwo")
    }

    // MARK: Shortcut bridge (9.2)

    let bridge = [
        AppleNotes.bridgeMarker,
        "Title: Krebs cycle",
        "Folder: School",
        "Krebs cycle",
        "The Krebs cycle runs inside the mitochondria of the cell and makes ATP.",
        AppleNotes.bridgeMarker,
        "Title: Stoicism",
        "Folder: ",
        "Virtue is the only good, said the Stoics, and reason is our guide.",
    ].joined(separator: "\n")

    func testBridgeSplitsNotesAndReadsTitleAndFolder() {
        let ns = AppleNotes.parseBridgeText(bridge)
        XCTAssertEqual(ns.map(\.title), ["Krebs cycle", "Stoicism"])
        XCTAssertEqual(ns.map(\.folder), ["School", nil])
        XCTAssertEqual(AppleNotes.pages(ns[0], now: now).first?.text, "The Krebs cycle runs inside the mitochondria of the cell and makes ATP.")
    }

    func testBridgeIdsAreStable() {
        XCTAssertEqual(AppleNotes.fnv1a(""), "811c9dc5")
        XCTAssertEqual(AppleNotes.fnv1a("a"), "e40c292c")
        let id = AppleNotes.parseBridgeText(bridge)[1].id
        XCTAssertEqual(id, "sc:" + AppleNotes.fnv1a("Stoicism\nVirtue is the only good, said the Stoics, and reason is our guide."))
        XCTAssertEqual(id, "sc:b9acf5b9")
    }

    // MARK: Note titles (9.5.1)

    func testNoteTitles() {
        let cases: [(String, String, String?)] = [
            ("Atomic Habits by James Clear", "Atomic Habits", "James Clear"),
            ("Notes on Thinking, Fast and Slow", "Thinking, Fast and Slow", nil),
            ("Atomic Habits ch 3", "Atomic Habits", nil),
            ("Seneca on time 3/14", "Seneca on time", nil),
            ("Sapiens summary", "Sapiens", nil),
            ("Stand by me", "Stand by me", nil),
        ]
        for (raw, title, author) in cases {
            let t = Grouper.cleanNoteTitle(raw)
            XCTAssertEqual(t.title, title, raw)
            XCTAssertEqual(t.author, author, raw)
        }
    }

    // MARK: Categories (9.4)

    func testCategoryRules() {
        XCTAssertEqual(Categories.categorize(title: "CHEM 210: Organic", type: nil, pages: []), "Chemistry")
        let work = [Page(kind: "note", text: "x", folder: "Work"), Page(kind: "note", text: "y", folder: "Work"), Page(kind: "note", text: "z")]
        XCTAssertEqual(Categories.categorize(title: "Ideas", type: nil, pages: work), "Work")
        XCTAssertEqual(Categories.categorize(title: "Ideas", type: "other", pages: [Page(kind: "note", text: "x", folder: "Notes")]), "General")
        XCTAssertEqual(Categories.categorize(title: "Something", type: "book", pages: [Page(kind: "note", text: "plain words about nothing")]), "Reading")
        XCTAssertEqual(Categories.categorize(title: "Something", type: "class", pages: []), "Classes")
    }

    func testGenericFoldersNeverNameACategory() {
        XCTAssertNil(Categories.sharedFolder(["Notes", "notes"]))
        XCTAssertEqual(Categories.sharedFolder(["School", "School", "Home"]), "School")
        XCTAssertNil(Categories.sharedFolder(["School", "Home"]))
    }

    func testLexiconNeedsThreeDistinctWords() {
        XCTAssertNil(Categories.lexiconCategory("cell cell cell cell cell"))
        XCTAssertEqual(Categories.lexiconCategory("The cell membrane and the cell nucleus hold the cell's genes."), "Biology")
    }

    func testBackfillsMissingCategoriesAndKeepsExisting() throws {
        var lib = try sample()
        for i in lib.projects.indices where lib.projects[i].id != "smpaurelis" { lib.projects[i].category = nil }
        lib.backfillCategories()
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: lib.projects.map { ($0.id, $0.category ?? "") }),
                       ["smpcarnegi": "Self-improvement", "smpaurelis": "Philosophy", "smpbio101": "Biology"])
    }

    // MARK: Grouping notes into projects (9.5)

    struct Row: Equatable { var title: String; var author: String?; var type: String; var category: String?; var pages: Int }

    func testFixtureGroupingParity() throws {
        let pages = AppleNotes.importNotes(try fixture(), known: [], now: now).pages
        let rows = Grouper.group(pages).map { Row(title: $0.title, author: $0.author, type: $0.type, category: $0.category, pages: $0.pageIds.count) }
        XCTAssertEqual(rows, [
            Row(title: "BIO 101", author: nil, type: "class", category: "Biology", pages: 5),
            Row(title: "Atomic Habits", author: "James Clear", type: "book", category: "Books", pages: 3),
            Row(title: "Meditations", author: "Marcus Aurelius", type: "book", category: "Reading", pages: 2),
            Row(title: "Philosophy notes", author: nil, type: "other", category: "Philosophy", pages: 2),
            Row(title: "Work", author: nil, type: "other", category: "Work", pages: 2),
            Row(title: "Loose notes", author: nil, type: "other", category: "General", pages: 1),
        ])
    }

    func testLoneNoteJoinsItsClass() throws {
        let pages = AppleNotes.importNotes(try fixture(), known: [], now: now).pages
        let bio = try XCTUnwrap(Grouper.group(pages).first { $0.title == "BIO 101" })
        let krebs = try XCTUnwrap(pages.first { $0.noteId == "x-coredata://n5" })
        XCTAssertTrue(bio.pageIds.contains(krebs.id))
    }
}

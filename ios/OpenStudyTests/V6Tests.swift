import XCTest

/// Usage data (spec 12.3): the upload cursor and category-only props.
final class V6Tests: XCTestCase {
    func ev(_ t: String, _ name: String = "x") -> LibraryEvent { LibraryEvent(t: t, name: name) }

    func testPendingStartsAfterTheCursorAndKeepsTies() {
        let events = [ev("2026-10-01T00:00:02.000Z", "b"), ev("2026-10-01T00:00:01.000Z", "a"),
                      ev("2026-10-01T00:00:02.000Z", "c"), ev("2026-10-01T00:00:03.000Z", "d")]
        XCTAssertEqual(Usage.pending(events, after: nil).map(\.name), ["a", "b", "c", "d"])
        // One of the two events at :02 was sent; the other still goes.
        let cursor = Usage.Cursor(t: "2026-10-01T00:00:02.000Z", seenAtT: 1)
        XCTAssertEqual(Usage.pending(events, after: cursor).map(\.name), ["c", "d"])
        XCTAssertEqual(Usage.pending(events, after: nil, limit: 2).map(\.name), ["a", "b"])
    }

    func testAdvanceCountsEventsAtTheLastTime() {
        let first = [ev("2026-10-01T00:00:01.000Z"), ev("2026-10-01T00:00:02.000Z")]
        let c1 = Usage.advance(nil, past: first)
        XCTAssertEqual(c1, Usage.Cursor(t: "2026-10-01T00:00:02.000Z", seenAtT: 1))
        let c2 = Usage.advance(c1, past: [ev("2026-10-01T00:00:02.000Z")])
        XCTAssertEqual(c2, Usage.Cursor(t: "2026-10-01T00:00:02.000Z", seenAtT: 2))
        XCTAssertEqual(Usage.advance(c2, past: []), c2)
    }

    func testFileTypes() {
        XCTAssertEqual(Usage.types(["pdf", "PNG", "jpg", "pptx", "pdf", "md", "zip"]), "image:2,pdf:2,other:1,pptx:1,text:1")
        XCTAssertEqual(Usage.types([]), "")
    }

    func testSortPropsHaveCountsAndCategoriesOnly() {
        let p = Usage.sortProps([("book", "Reading", 3), ("class", "Biology", 5), ("other", nil, 1), ("book", "Reading", 2)])
        XCTAssertEqual(p["pages"], .number(11))
        XCTAssertEqual(p["groups"], .number(4))
        XCTAssertEqual(p["books"], .number(2))
        XCTAssertEqual(p["classes"], .number(1))
        XCTAssertEqual(p["others"], .number(1))
        XCTAssertEqual(p["categories"], .string("Reading,Biology"))
        let long = Usage.sortProps((0..<10).map { ("book", "Category number \($0)", 1) })
        if case .string(let s) = long["categories"] { XCTAssertLessThanOrEqual(s.count, 60) } else { XCTFail() }
    }
}

import Foundation

/// Usage data (spec 12.3): which library events still need to go to the server, and the
/// category-only props for imports and sorting. Pure, so it is shared with the unit tests.
public enum Usage {
    public static let batchSize = 200

    /// The last event sent: its time, and how many events with exactly that time were sent
    /// (two events can share a millisecond).
    public struct Cursor: Codable, Equatable {
        public var t: String
        public var seenAtT: Int
        public init(t: String, seenAtT: Int = 0) { self.t = t; self.seenAtT = seenAtT }
    }

    /// Events after the cursor, oldest first, at most `limit`.
    public static func pending(_ events: [LibraryEvent], after cursor: Cursor?, limit: Int = batchSize) -> [LibraryEvent] {
        let sorted = events.enumerated().sorted { ($0.element.t, $0.offset) < ($1.element.t, $1.offset) }.map(\.element)
        guard let cursor else { return Array(sorted.prefix(limit)) }
        var skipped = 0
        var out: [LibraryEvent] = []
        for e in sorted {
            if e.t < cursor.t { continue }
            if e.t == cursor.t, skipped < cursor.seenAtT { skipped += 1; continue }
            out.append(e)
            if out.count == limit { break }
        }
        return out
    }

    /// The cursor after `sent` (a non-empty result of `pending`) reached the server.
    public static func advance(_ cursor: Cursor?, past sent: [LibraryEvent]) -> Cursor? {
        guard let last = sent.last?.t else { return cursor }
        let atLast = sent.filter { $0.t == last }.count
        let carried = cursor?.t == last ? cursor!.seenAtT : 0
        return Cursor(t: last, seenAtT: carried + atLast)
    }

    /// File type group for an extension: pdf, image, pptx, docx, text, json, other.
    public static func fileType(_ ext: String) -> String {
        switch ext.lowercased() {
        case "pdf": return "pdf"
        case "png", "jpg", "jpeg", "heic", "heif", "gif", "webp", "tif", "tiff", "bmp": return "image"
        case "pptx", "ppt", "key": return "pptx"
        case "docx", "doc": return "docx"
        case "txt", "md", "markdown", "html", "htm", "rtf", "text": return "text"
        case "json": return "json"
        default: return "other"
        }
    }

    /// "pdf:2,image:5": counts by file type group, most first, then by name.
    public static func types(_ extensions: [String]) -> String {
        var counts: [String: Int] = [:]
        for e in extensions { counts[fileType(e), default: 0] += 1 }
        return counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .map { "\($0.key):\($0.value)" }.joined(separator: ",")
    }

    /// `sort_done` props for a fresh grouping: counts by type and the distinct categories.
    public static func sortProps(_ groups: [(type: String, category: String?, pages: Int)]) -> [String: JSONValue] {
        // Whole names only, within the server's 60 character limit.
        var cats: [String] = []
        for g in groups {
            guard let c = g.category, !c.isEmpty, !cats.contains(c), (cats + [c]).joined(separator: ",").count <= 60 else { continue }
            cats.append(c)
        }
        return [
            "pages": .number(Double(groups.reduce(0) { $0 + $1.pages })),
            "groups": .number(Double(groups.count)),
            "books": .number(Double(groups.filter { $0.type == "book" }.count)),
            "classes": .number(Double(groups.filter { $0.type == "class" }.count)),
            "others": .number(Double(groups.filter { $0.type != "book" && $0.type != "class" }.count)),
            "categories": .string(cats.joined(separator: ",")),
        ]
    }
}

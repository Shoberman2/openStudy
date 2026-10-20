import Foundation

// MARK: - Same book, different spelling (spec 10.4, ported from BookSaver sort/identity.ts)

public enum Identity {
    /// NFKD, combining marks removed, lowercase, runs of non letters/digits to one space, trimmed.
    public static func normalizeLookup(_ s: String) -> String {
        let folded = String(String.UnicodeScalarView(s.decomposedStringWithCompatibilityMapping.unicodeScalars.filter { !(0x300...0x36F).contains($0.value) }))
        return folded.lowercased()
            .replacingOccurrences(of: "[^\\p{L}\\p{N}]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    public static func normalizeTitle(_ t: String) -> String {
        normalizeLookup(t.replacingOccurrences(of: "&", with: " and "))
            .replacingOccurrences(of: "^(the|a|an)\\s+", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    static let subtitle = try! NSRegularExpression(pattern: "\\s*[:|]\\s+|\\s+[-\u{2013}\u{2014}]\\s+|\\s*\\(")

    /// Title without subtitle ("Sapiens: A Brief History" -> "Sapiens").
    public static func baseTitle(_ t: String) -> String {
        let ns = t as NSString
        let cut = subtitle.firstMatch(in: t, range: NSRange(location: 0, length: ns.length)).map { ns.substring(to: $0.range.location) } ?? t
        let trimmed = cut.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? t.trimmingCharacters(in: .whitespaces) : trimmed
    }

    public static func similarity(_ a: String, _ b: String) -> Double {
        let m = max(a.count, b.count)
        return m == 0 ? 1 : 1 - Double(AnswerChecker.levenshtein(a, b)) / Double(m)
    }

    static func digitRuns(_ s: String) -> [String] {
        let re = try! NSRegularExpression(pattern: "\\d+")
        let ns = s as NSString
        return re.matches(in: s, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) }
    }

    public static func titlesMatch(_ a: String, _ b: String) -> Bool {
        let na = normalizeTitle(a), nb = normalizeTitle(b)
        guard !na.isEmpty, !nb.isEmpty, digitRuns(na) == digitRuns(nb) else { return false }
        if na == nb { return true }
        let ba = normalizeTitle(baseTitle(a)), bb = normalizeTitle(baseTitle(b))
        if !ba.isEmpty && ba == bb { return true }
        let ta = na.split(separator: " ").map(String.init), tb = nb.split(separator: " ").map(String.init)
        let (short, long) = ta.count <= tb.count ? (ta, tb) : (tb, ta)
        if short.joined().count >= 5, short.enumerated().allSatisfy({ $0.offset < long.count && long[$0.offset] == $0.element }) { return true }
        for (x, y) in [(na, nb), (ba, bb)] where x.count >= 6 && y.count >= 6 && similarity(x, y) >= 0.85 { return true }
        return false
    }

    public static func normalizeAuthor(_ raw: String?) -> String {
        guard let raw else { return "" }
        return normalizeLookup(raw.replacingOccurrences(of: "^by\\s+", with: "", options: [.regularExpression, .caseInsensitive]))
    }

    /// "James Clear" vs "Clear, James" vs "J. Clear".
    public static func sameAuthor(_ a: String?, _ b: String?) -> Bool {
        let na = normalizeAuthor(a), nb = normalizeAuthor(b)
        guard !na.isEmpty, !nb.isEmpty else { return false }
        if na == nb { return true }
        let ta = na.split(separator: " ").map(String.init).filter { $0.count > 1 }
        let tb = nb.split(separator: " ").map(String.init).filter { $0.count > 1 }
        if let la = ta.last, tb.contains(la) || (tb.last.map { ta.contains($0) } ?? false) { return true }
        return similarity(na, nb) >= 0.85
    }

    /// Titles match and authors do not conflict (both set and different blocks a match).
    public static func sameWork(title a: String, author aa: String?, title b: String, author ab: String?) -> Bool {
        guard titlesMatch(a, b) else { return false }
        let has = { (s: String?) in !(s ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
        return !(has(aa) && has(ab)) || sameAuthor(aa, ab)
    }
}

// MARK: - Page numbers (spec 10.5)

public enum PageNumbers {
    static let patterns = [
        try! NSRegularExpression(pattern: "\\bpage\\s+(\\d{1,4})\\b", options: [.caseInsensitive]),
        try! NSRegularExpression(pattern: "\\bp\\.\\s*(\\d{1,4})\\b", options: [.caseInsensitive]),
        try! NSRegularExpression(pattern: "^(\\d{1,4})\\s+of\\s+\\d{1,5}$", options: [.caseInsensitive]),
        try! NSRegularExpression(pattern: "^(\\d{1,4})$"),
    ]

    /// Footer lines first, then header lines. "N pages left" and percentages are ignored, and so is 0.
    public static func fromLines(footer: [String], header: [String]) -> Int? {
        for raw in footer + header {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.lowercased().contains("left") || line.contains("%") { continue }
            let ns = line as NSString
            for re in patterns {
                if let m = re.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)),
                   let n = Int(ns.substring(with: m.range(at: 1))), n > 0 { return n }
            }
        }
        return nil
    }

    /// Reading order when >= 50% of the screenshots carry a page number; numberless pages go after.
    public static func ordered(_ pages: [Page]) -> [Page] {
        let shots = pages.filter { $0.kind == "screenshot" }
        let numbered = shots.filter { $0.pageNumber != nil }.count
        guard !shots.isEmpty, Double(numbered) >= 0.5 * Double(shots.count) else { return pages }
        let withN = pages.filter { $0.pageNumber != nil }.enumerated().sorted { a, b in
            let x = a.element, y = b.element
            if x.pageNumber! != y.pageNumber! { return x.pageNumber! < y.pageNumber! }
            if x.createdAt != y.createdAt { return x.createdAt < y.createdAt }
            return a.offset < b.offset
        }.map(\.element)
        return withN + pages.filter { $0.pageNumber == nil }
    }
}

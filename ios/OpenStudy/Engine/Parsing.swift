import Foundation

// MARK: - Notes "Excerpt From" parser (spec 3.2)

public struct ParsedExcerpt: Equatable {
    public var text: String
    public var title: String?
    public var author: String?
    public var fromFooter: Bool
}

public enum NotesParser {
    static let copyrightPrefix = "this material may be protected by copyright"

    public static func parse(_ raw: String) -> [ParsedExcerpt] {
        let text = raw.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let lines = text.components(separatedBy: "\n")
        var out: [ParsedExcerpt] = []
        var buffer: [String] = []
        var i = 0
        var sawFooter = false
        while i < lines.count {
            let t = lines[i].trimmingCharacters(in: .whitespaces)
            if t.lowercased() == "excerpt from" || t.lowercased().hasPrefix("excerpt from ") && t.count > 13 && !t.contains(".") {
                sawFooter = true
                var title: String?
                var author: String?
                var j = i + 1
                if t.count > 13 { title = String(t.dropFirst(13)).trimmingCharacters(in: .whitespaces) }
                func nextNonEmpty() -> String? {
                    while j < lines.count, lines[j].trimmingCharacters(in: .whitespaces).isEmpty { j += 1 }
                    guard j < lines.count else { return nil }
                    return lines[j].trimmingCharacters(in: .whitespaces)
                }
                if title == nil, let l = nextNonEmpty(), !l.lowercased().hasPrefix(copyrightPrefix) { title = l; j += 1 }
                if let l = nextNonEmpty(), !l.lowercased().hasPrefix(copyrightPrefix) { author = l; j += 1 }
                if let l = nextNonEmpty(), l.lowercased().hasPrefix(copyrightPrefix) { j += 1 }
                let body = cleanExcerpt(buffer.joined(separator: "\n"))
                if !body.isEmpty {
                    out.append(ParsedExcerpt(text: body, title: title, author: author, fromFooter: true))
                }
                buffer = []
                i = j
                continue
            }
            buffer.append(lines[i])
            i += 1
        }
        let rest = buffer.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if !rest.isEmpty {
            out.append(contentsOf: plainParagraphs(rest, allowTitle: !sawFooter))
        }
        return out
    }

    static func cleanExcerpt(_ s: String) -> String {
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        // Books wraps copied text in curly quotes.
        let pairs: [(Character, Character)] = [("\u{201C}", "\u{201D}"), ("\"", "\"")]
        for (o, c) in pairs where t.first == o && t.last == c && t.count > 2 {
            let inner = t.dropFirst().dropLast()
            if !inner.contains(o) && !inner.contains(c) { t = String(inner) }
        }
        return TextKit.collapseWhitespace(t)
    }

    /// Text without the footer: each paragraph or bullet becomes a page; a short first line is the title.
    static func plainParagraphs(_ s: String, allowTitle: Bool) -> [ParsedExcerpt] {
        var lines = s.components(separatedBy: "\n")
        var title: String?
        if allowTitle, let first = lines.first?.trimmingCharacters(in: .whitespaces), !first.isEmpty,
           first.count < 60, !first.contains("."), lines.count > 1 {
            title = first.trimmingCharacters(in: CharacterSet(charactersIn: "#*- ")).trimmingCharacters(in: .whitespaces)
            lines.removeFirst()
        }
        var paragraphs: [String] = []
        var cur: [String] = []
        func flush() {
            let p = TextKit.collapseWhitespace(cur.joined(separator: " "))
            if !p.isEmpty { paragraphs.append(p) }
            cur = []
        }
        let bullet = try! NSRegularExpression(pattern: "^\\s*([-*\u{2022}\u{2023}\u{25E6}]|\\d+[.)])\\s+")
        for line in lines {
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.isEmpty { flush(); continue }
            let range = NSRange(t.startIndex..., in: t)
            if let m = bullet.firstMatch(in: t, range: range) {
                flush()
                cur.append(String(t[Range(m.range, in: t)!.upperBound...]))
                flush()
                continue
            }
            if t.hasPrefix("#") { flush(); continue } // markdown headings are not content
            cur.append(t)
        }
        flush()
        return paragraphs.map { ParsedExcerpt(text: cleanExcerpt($0), title: title, author: nil, fromFooter: false) }
    }

    public static func pages(from raw: String, title: String? = nil, now: Date = Date()) -> [Page] {
        let list = WordList.parse(raw, title: title)
        if list.isWordList {
            return [Page(kind: "note", text: WordList.pageText(raw), createdAt: ISO.string(now), heading: Grouper.words, words: list.words)]
        }
        return parse(raw).map {
            Page(kind: "note", text: $0.text, suggestedTitle: $0.title, suggestedAuthor: $0.author, createdAt: ISO.string(now), verbatim: $0.fromFooter ? true : nil)
        }
    }
}

// MARK: - Screenshot OCR cleanup (spec 3.1)

public struct OCRLine: Equatable {
    public var text: String
    /// Normalized, top-left origin: 0 = top of image, 1 = bottom.
    public var top: Double
    public var bottom: Double
    public var left: Double
    public var right: Double
    public init(text: String, top: Double, bottom: Double, left: Double = 0, right: Double = 1) {
        self.text = text; self.top = top; self.bottom = bottom; self.left = left; self.right = right
    }
}

public struct CleanedScreenshot: Equatable {
    public var header: String?
    public var body: String
    public var isBookPage: Bool
    public var pageNumber: Int? = nil   // v4: read from the header/footer zones (spec 10.5)
}

public enum ScreenshotCleaner {
    static let noise = try! NSRegularExpression(pattern: "^\\d{1,2}:\\d{2}|%$|\\b(LTE|5G|4G|3G|5GE|Wi-?Fi)\\b", options: [.caseInsensitive])
    static let footerish = try! NSRegularExpression(pattern: "^(\\d+\\s*(of|/)\\s*\\d+|\\d+|page \\d+.*|\\d+ (pages?|min(ute)?s?) left.*)$", options: [.caseInsensitive])

    static func isNoise(_ s: String) -> Bool {
        let t = s.trimmingCharacters(in: .whitespaces)
        if t.count < 3 { return true }
        let r = NSRange(t.startIndex..., in: t)
        return noise.firstMatch(in: t, range: r) != nil
    }

    public static func clean(_ input: [OCRLine]) -> CleanedScreenshot {
        let lines = input.sorted { $0.top < $1.top }
        var headers: [String] = []
        var body: [OCRLine] = []
        var headerZone: [String] = []
        var footerZone: [String] = []
        for l in lines {
            let t = l.text.trimmingCharacters(in: .whitespaces)
            // Page numbers are read before noise filtering drops short lines like "47".
            if l.top < 0.09 { headerZone.append(t) } else if l.bottom > 0.93 { footerZone.append(t) }
            if isNoise(t) { continue }
            if l.top < 0.09 { headers.append(t); continue }
            if l.bottom > 0.93 { continue } // footer: page numbers, "12 of 280", "5 pages left"
            let r = NSRange(t.startIndex..., in: t)
            if footerish.firstMatch(in: t, range: r) != nil && l.top > 0.8 { footerZone.append(t); continue }
            body.append(OCRLine(text: t, top: l.top, bottom: l.bottom, left: l.left, right: l.right))
        }
        let header = headers.max(by: { $0.count < $1.count })
        let text = joinBody(body)
        return CleanedScreenshot(header: header, body: text, isBookPage: isBookText(text),
                                 pageNumber: PageNumbers.fromLines(footer: footerZone, header: headerZone))
    }

    /// Joins hyphenated breaks, wraps lines into paragraphs, collapses whitespace.
    static func joinBody(_ lines: [OCRLine]) -> String {
        guard !lines.isEmpty else { return "" }
        var gaps: [Double] = []
        for i in 1..<max(1, lines.count) where lines.count > 1 { gaps.append(lines[i].top - lines[i - 1].bottom) }
        let sorted = gaps.sorted()
        let median = sorted.isEmpty ? 0 : sorted[sorted.count / 2]
        let minLeft = lines.map(\.left).min() ?? 0
        var paragraphs: [String] = []
        var cur = ""
        for (i, l) in lines.enumerated() {
            let t = l.text
            if i > 0 {
                let gap = l.top - lines[i - 1].bottom
                let prev = cur.trimmingCharacters(in: .whitespaces)
                let endsSentence = prev.last.map { ".?!\u{201D}\"".contains($0) } ?? false
                let indented = l.left - minLeft > 0.03
                if gap > max(median * 1.8, 0.012) || (endsSentence && indented) {
                    paragraphs.append(cur); cur = ""
                }
            }
            if cur.hasSuffix("-"), let f = t.first, f.isLowercase {
                cur.removeLast()
                cur += t
            } else {
                cur += cur.isEmpty ? t : " " + t
            }
        }
        if !cur.isEmpty { paragraphs.append(cur) }
        return paragraphs.map(TextKit.collapseWhitespace).filter { !$0.isEmpty }.joined(separator: "\n\n")
    }

    /// Book pages: >= 40 words and >= 60% alphabetic word tokens.
    public static func isBookText(_ text: String) -> Bool {
        let ws = TextKit.words(text)
        guard ws.count >= 40 else { return false }
        let alpha = ws.filter { w in
            let core = w.trimmingCharacters(in: .punctuationCharacters)
            return !core.isEmpty && core.allSatisfy { $0.isLetter || $0 == "'" || $0 == "\u{2019}" || $0 == "-" }
        }.count
        return Double(alpha) / Double(ws.count) >= 0.6
    }
}

// MARK: - Photo OCR text (spec 8.2): keep list and line structure for notes and whiteboards

public enum PhotoText {
    /// Joins OCR lines into text. Lines that end short of the block's right edge, end with ":" or a period,
    /// or are followed by a bullet keep their own line, so "Term: definition" lines survive.
    public static func join(_ input: [OCRLine]) -> String {
        let lines = input.filter { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty }.sorted { $0.top < $1.top }
        guard !lines.isEmpty else { return "" }
        let maxRight = lines.map(\.right).max() ?? 1
        let minLeft = lines.map(\.left).min() ?? 0
        let width = max(0.01, maxRight - minLeft)
        let heights = lines.map { $0.bottom - $0.top }.sorted()
        let lineH = heights[heights.count / 2]
        var out = ""
        for (i, l) in lines.enumerated() {
            let t = l.text.trimmingCharacters(in: .whitespaces)
            if i == 0 { out = t; continue }
            let prev = lines[i - 1]
            let prevText = prev.text.trimmingCharacters(in: .whitespaces)
            let gap = l.top - prev.bottom
            let bullet = t.range(of: "^([-*\u{2022}]|\\d+[.)])\\s", options: .regularExpression) != nil
            let short = (prev.right - minLeft) / width < 0.8
            let ends = prevText.hasSuffix(":") || prevText.hasSuffix(".") || prevText.hasSuffix("?") || prevText.hasSuffix("!")
            // A new "Term: ..." line on a board or in notes starts its own line.
            let label = t.range(of: "^[A-Z][A-Za-z0-9' ]{0,40}:\\s", options: .regularExpression) != nil && !prevText.hasSuffix(",")
            // A lowercase line after a "Term: definition" line that states its own fact ("pH scale goes from 0 to 14")
            // is a new item, not the end of the definition.
            let prevIsDefinition = prevText.range(of: "^[A-Z][A-Za-z0-9' ]{0,40}:\\s", options: .regularExpression) != nil
            let ownFact = t.first?.isLowercase == true &&
                t.range(of: "^[A-Za-z0-9']+( [A-Za-z0-9']+){0,4} (is|are|goes|go|runs|run|from|means|refers)\\b", options: .regularExpression) != nil
            let newItem = prevIsDefinition && ownFact
            if gap > lineH * 1.2 { out += "\n\n" + t }
            else if bullet || short || ends || label || newItem { out += "\n" + t }
            else if out.hasSuffix("-"), t.first?.isLowercase == true { out.removeLast(); out += t }
            else { out += " " + t }
        }
        return out
    }
}

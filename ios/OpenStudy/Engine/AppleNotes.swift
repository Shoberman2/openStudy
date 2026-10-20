import Foundation

// MARK: - Apple Notes import (spec 9.2, 9.3): the Mac export file and the iPhone Shortcut bridge.
// Mirrors web/src/engine/applenotes.ts.

public struct AppleNote: Codable, Equatable {
    public var id: String
    public var title: String
    public var folder: String?
    public var created: String?
    public var modified: String?
    public var html: String?
    public var text: String?

    public init(id: String, title: String, folder: String? = nil, created: String? = nil, modified: String? = nil, html: String? = nil, text: String? = nil) {
        self.id = id; self.title = title; self.folder = folder; self.created = created; self.modified = modified; self.html = html; self.text = text
    }

    enum CodingKeys: String, CodingKey { case id, title, folder, created, modified, html, text }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        folder = try c.decodeIfPresent(String.self, forKey: .folder)
        created = try c.decodeIfPresent(String.self, forKey: .created)
        modified = try c.decodeIfPresent(String.self, forKey: .modified)
        html = try c.decodeIfPresent(String.self, forKey: .html)
        text = try c.decodeIfPresent(String.self, forKey: .text)
    }
}

public struct NotesExport: Decodable {
    public var openstudyNotes: Int
    public var exportedAt: String?
    public var notes: [AppleNote]

    /// A `.json` file whose top level has `openstudyNotes: 1`.
    public static func decode(_ data: Data) -> NotesExport? {
        guard let e = try? JSONDecoder().decode(NotesExport.self, from: data), e.openstudyNotes == 1 else { return nil }
        return e
    }
}

public struct NotesImport: Equatable {
    public var pages: [Page]
    public var notes: Int
    public var already: Int
    public var empty: Int

    public var summary: String {
        if pages.isEmpty && already > 0 { return "Nothing new. \(already == 1 ? "That note was" : "All \(already) notes were") already here." }
        var s = "Added \(pages.count) \(pages.count == 1 ? "page" : "pages") from \(notes) \(notes == 1 ? "note" : "notes")."
        if already > 0 { s += " \(already) \(already == 1 ? "was" : "were") already here." }
        return s
    }
}

public enum AppleNotes {
    public static let bridgeMarker = "=== OpenStudy note ==="
    static let pageWords = 250

    /// FNV-1a 32 bit over UTF-8, lowercase hex (stable ids for Shortcut notes on both platforms).
    public static func fnv1a(_ s: String) -> String {
        var h: UInt32 = 0x811c9dc5
        for b in s.utf8 { h ^= UInt32(b); h = h &* 0x01000193 }
        return String(format: "%08x", h)
    }

    public static func hasBridgeMarker(_ text: String) -> Bool {
        text.components(separatedBy: .newlines).contains { $0.trimmingCharacters(in: .whitespaces) == bridgeMarker }
    }

    static func trim(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// JS `slice(0, n)` semantics (UTF-16 units) so ids match the web app.
    static func utf16Prefix(_ s: String, _ n: Int) -> String { String(decoding: Array(s.utf16.prefix(n)), as: UTF16.self) }

    static let fieldRe = try! NSRegularExpression(pattern: "^(Title|Folder):\\s?(.*)$")

    /// Text copied by the Shortcut: one chunk per note, optional Title:/Folder: lines (9.2).
    public static func parseBridgeText(_ text: String) -> [AppleNote] {
        var chunks: [[String]] = []
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        for line in normalized.components(separatedBy: "\n") {
            if trim(line) == bridgeMarker { chunks.append([]) }
            else if !chunks.isEmpty { chunks[chunks.count - 1].append(line) }
        }
        var out: [AppleNote] = []
        for var lines in chunks {
            var title = ""
            var folder: String?
            while let f = lines.first, trim(f).isEmpty { lines.removeFirst() }
            while let f = lines.first, let m = fieldRe.firstMatch(in: f, range: NSRange(location: 0, length: (f as NSString).length)) {
                let key = (f as NSString).substring(with: m.range(at: 1))
                let value = trim((f as NSString).substring(with: m.range(at: 2)))
                if key == "Title" { title = value } else { folder = value.isEmpty ? nil : value }
                lines.removeFirst()
            }
            let body = trim(lines.joined(separator: "\n"))
            if body.isEmpty && title.isEmpty { continue }
            out.append(AppleNote(id: "sc:" + fnv1a(title + "\n" + utf16Prefix(body, 200)), title: title, folder: folder, text: body))
        }
        return out
    }

    // MARK: html

    static func replace(_ s: String, _ pattern: String, _ with: String, _ opts: NSRegularExpression.Options = [.caseInsensitive]) -> String {
        guard let re = try? NSRegularExpression(pattern: pattern, options: opts) else { return s }
        return re.stringByReplacingMatches(in: s, range: NSRange(location: 0, length: (s as NSString).length), withTemplate: with)
    }

    /// Port of the web stripHtml (block tags and <br> become newlines, entities decoded).
    static func stripHtml(_ html: String) -> String {
        var t = replace(html, "<\\s*(script|style)[^>]*>[\\s\\S]*?<\\s*/\\s*\\1\\s*>", "")
        t = replace(t, "<\\s*br\\s*/?>", "\n")
        t = replace(t, "<\\s*/\\s*(p|div|li|h[1-6]|blockquote)\\s*>", "\n\n")
        t = replace(t, "<[^>]+>", "", [])
        for (k, v) in [("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&apos;", "'")] {
            t = t.replacingOccurrences(of: k, with: v)
        }
        let re = try! NSRegularExpression(pattern: "&#(\\d+);")
        let ns = t as NSString
        var out = ""
        var last = 0
        for m in re.matches(in: t, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let code = Int(ns.substring(with: m.range(at: 1))) ?? 32
            out += String(decoding: [UInt16(truncatingIfNeeded: code)], as: UTF16.self)
            last = m.range.location + m.range.length
        }
        return out + ns.substring(from: last)
    }

    /// Note html to text with `#` headings, keeping paragraph breaks.
    public static func htmlToText(_ html: String) -> String {
        let re = try! NSRegularExpression(pattern: "<\\s*h([1-3])[^>]*>([\\s\\S]*?)<\\s*/\\s*h\\1\\s*>", options: [.caseInsensitive])
        let ns = html as NSString
        var marked = ""
        var last = 0
        for m in re.matches(in: html, range: NSRange(location: 0, length: ns.length)) {
            marked += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let n = Int(ns.substring(with: m.range(at: 1))) ?? 1
            marked += "\n\n" + String(repeating: "#", count: n) + " " + ns.substring(with: m.range(at: 2)) + "\n\n"
            last = m.range.location + m.range.length
        }
        marked += ns.substring(from: last)
        var t = replace(stripHtml(marked), "[ \\t]+\\n", "\n", [])
        t = replace(t, "\\n{3,}", "\n\n", [])
        return trim(t)
    }

    // MARK: pages

    static let headingRe = try! NSRegularExpression(pattern: "^#{1,3}\\s+(.+)$")

    /// Sections at `#` headings; blank lines end a paragraph; bullets lose their markers.
    static func sections(_ body: String) -> [(heading: String?, paras: [String])] {
        var out: [(heading: String?, paras: [String])] = [(nil, [])]
        var para: [String] = []
        func flush() {
            if !para.isEmpty { out[out.count - 1].paras.append(para.joined(separator: "\n")) }
            para = []
        }
        for raw in body.components(separatedBy: "\n") {
            let line = trim(raw)
            if let m = headingRe.firstMatch(in: line, range: NSRange(location: 0, length: (line as NSString).length)) {
                flush()
                out.append((trim((line as NSString).substring(with: m.range(at: 1))), []))
            } else if line.isEmpty { flush() }
            else { para.append(replace(line, "^(?:[-*\u{2022}]|\\d+[.)])\\s+", "", [])) }
        }
        flush()
        return out.filter { !$0.paras.isEmpty }
    }

    /// Pages of about 250 words, split at paragraph boundaries.
    static func chunk(_ paras: [String]) -> [String] {
        var out: [String] = []
        var cur: [String] = []
        var n = 0
        for p in paras {
            let w = TextKit.wordCount(p)
            if !cur.isEmpty && n + w > pageWords { out.append(cur.joined(separator: "\n\n")); cur = []; n = 0 }
            cur.append(p); n += w
        }
        if !cur.isEmpty { out.append(cur.joined(separator: "\n\n")) }
        return out
    }

    /// One note to pages (9.3). Returns [] for notes to skip.
    public static func pages(_ note: AppleNote, now: Date = Date()) -> [Page] {
        if trim(note.folder ?? "").lowercased() == "recently deleted" { return [] }
        var body = trim((note.text ?? note.html.map(htmlToText) ?? "").replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n"))
        let lines = body.components(separatedBy: "\n")
        var title = trim(note.title)
        let firstIndex = lines.firstIndex { !trim($0).isEmpty }
        let first = firstIndex.map { replace(trim(lines[$0]), "^#{1,3}\\s+", "", []) } ?? ""
        if title.isEmpty { title = utf16Prefix(first, 80) }
        if !first.isEmpty, first == title, let fi = firstIndex { body = trim(lines[(fi + 1)...].joined(separator: "\n")) }
        guard TextKit.wordCount(body) >= 8 else { return [] }
        let createdAt = note.created.flatMap(ISO.date).map(ISO.string) ?? ISO.string(now)
        let folder = note.folder.map(trim).flatMap { $0.isEmpty ? nil : $0 }
        let source: String? = title.isEmpty ? nil : title

        if body.range(of: "Excerpt From", options: .caseInsensitive) != nil {
            return NotesParser.parse(body).enumerated().map { i, e in
                Page(kind: "note", text: e.text, suggestedTitle: e.title, suggestedAuthor: e.author, createdAt: createdAt,
                     sourceName: source, sourceIndex: i + 1, verbatim: e.fromFooter ? true : nil, folder: folder, noteId: note.id)
            }
        }
        let list = WordList.parse(body, title: title)
        if list.isWordList {
            return [Page(kind: "note", text: WordList.pageText(body), createdAt: createdAt, sourceName: source, sourceIndex: 1,
                         heading: Grouper.words, folder: folder, noteId: note.id, words: list.words)]
        }
        var out: [Page] = []
        for s in sections(body) {
            for (i, text) in chunk(s.paras).enumerated() {
                let heading = i == 0 ? (s.heading ?? title) : s.heading
                out.append(Page(kind: "note", text: text, createdAt: createdAt, sourceName: source, sourceIndex: out.count + 1,
                                heading: (heading ?? "").isEmpty ? nil : heading, folder: folder, noteId: note.id))
            }
        }
        return out
    }

    /// Every note to pages, skipping notes already in the library (by noteId).
    public static func importNotes(_ notes: [AppleNote], known: Set<String>, now: Date = Date()) -> NotesImport {
        var r = NotesImport(pages: [], notes: 0, already: 0, empty: 0)
        var seen = known
        for n in notes where !n.id.isEmpty {
            if seen.contains(n.id) { r.already += 1; continue }
            seen.insert(n.id)
            let ps = pages(n, now: now)
            if ps.isEmpty {
                if (n.folder ?? "").lowercased() != "recently deleted" { r.empty += 1 }
                continue
            }
            r.pages += ps
            r.notes += 1
        }
        return r
    }
}

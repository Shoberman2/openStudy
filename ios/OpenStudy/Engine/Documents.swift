import Foundation

/// One extracted unit of a source file (a slide, a PDF page, a doc section).
public struct ExtractedPage: Equatable {
    public var text: String
    public var heading: String?
    public var index: Int
    public init(text: String, heading: String? = nil, index: Int) { self.text = text; self.heading = heading; self.index = index }
}

public struct ExtractedDoc: Equatable {
    public var title: String?
    public var pages: [ExtractedPage]
}

// MARK: - Tiny XML walker

/// Collects paragraphs from OOXML. Calls back per element so PPTX and DOCX can share it.
final class OOXMLWalker: NSObject, XMLParserDelegate {
    struct Paragraph { var text: String; var style: String?; var placeholder: String? }
    var paragraphs: [Paragraph] = []
    private var current = ""
    private var inText = false
    private var inPara = false
    private var style: String?
    private var shapePlaceholder: String?
    private var shapeDepth = 0
    private let paraTag: String, textTag: String, shapeTag: String?

    init(paraTag: String, textTag: String, shapeTag: String?) {
        self.paraTag = paraTag; self.textTag = textTag; self.shapeTag = shapeTag
    }

    static func parse(_ xml: Data, para: String, text: String, shape: String?) -> [Paragraph] {
        let w = OOXMLWalker(paraTag: para, textTag: text, shapeTag: shape)
        let p = XMLParser(data: xml)
        p.delegate = w
        p.shouldProcessNamespaces = false
        p.parse()
        return w.paragraphs
    }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName q: String?, attributes a: [String: String] = [:]) {
        if let shapeTag, name == shapeTag { shapeDepth += 1; if shapeDepth == 1 { shapePlaceholder = nil } }
        switch name {
        case "p:ph": shapePlaceholder = a["type"] ?? "body"
        case paraTag: inPara = true; current = ""; style = nil
        case textTag: inText = true
        case "w:pStyle": style = a["w:val"]
        case "w:tab", "a:tab": if inPara { current += " " }
        case "w:br", "a:br": if inPara { current += "\n" }
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { if inText { current += string } }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName q: String?) {
        if name == textTag { inText = false }
        if name == paraTag {
            inPara = false
            let t = current.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { paragraphs.append(Paragraph(text: t, style: style, placeholder: shapeTag == nil ? nil : shapePlaceholder)) }
        }
        if let shapeTag, name == shapeTag { shapeDepth -= 1; if shapeDepth == 0 { shapePlaceholder = nil } }
    }
}

public enum DocumentParser {
    static func coreTitle(_ zip: ZipArchive) -> String? {
        guard let xml = try? zip.string(for: "docProps/core.xml"),
              let r = xml.range(of: "<dc:title>([^<]+)</dc:title>", options: .regularExpression) else { return nil }
        let t = String(xml[r]).replacingOccurrences(of: "<dc:title>", with: "").replacingOccurrences(of: "</dc:title>", with: "")
        let clean = decodeEntities(t).trimmingCharacters(in: .whitespaces)
        return clean.isEmpty || clean.lowercased() == "powerpoint presentation" ? nil : clean
    }

    static func decodeEntities(_ s: String) -> String {
        s.replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&apos;", with: "'")
    }

    static func number(in name: String) -> Int {
        Int(name.components(separatedBy: CharacterSet.decimalDigits.inverted).filter { !$0.isEmpty }.last ?? "") ?? 0
    }

    // MARK: PPTX

    public static func pptx(_ data: Data) throws -> ExtractedDoc {
        let zip = try ZipArchive(data: data)
        let slides = zip.names.filter { $0.hasPrefix("ppt/slides/slide") && $0.hasSuffix(".xml") }.sorted { number(in: $0) < number(in: $1) }
        var pages: [ExtractedPage] = []
        var referencedNotes = Set<String>()
        for r in zip.names where r.hasPrefix("ppt/slides/_rels/") {
            if let rels = try zip.string(for: r), let m = rels.range(of: "notesSlides/notesSlide[0-9]+\\.xml", options: .regularExpression) {
                referencedNotes.insert("ppt/" + String(rels[m]))
            }
        }
        for (i, name) in slides.enumerated() {
            guard let xml = try zip.data(for: name) else { continue }
            let paras = OOXMLWalker.parse(xml, para: "a:p", text: "a:t", shape: "p:sp")
            let skip: Set<String> = ["sldNum", "dt", "ftr"]
            let heading = paras.filter { $0.placeholder == "title" || $0.placeholder == "ctrTitle" }.map(\.text).joined(separator: " ")
            var lines = paras.filter { !skip.contains($0.placeholder ?? "") && $0.placeholder != "title" && $0.placeholder != "ctrTitle" }.map(\.text)
            // Speaker notes: via the slide's relationships, falling back to the same number.
            let n = number(in: name)
            var notesName: String? = "ppt/notesSlides/notesSlide\(n).xml"
            if let rels = try zip.string(for: "ppt/slides/_rels/slide\(n).xml.rels") {
                notesName = rels.range(of: "notesSlides/notesSlide[0-9]+\\.xml", options: .regularExpression).map { "ppt/" + String(rels[$0]) }
            } else if let nn = notesName, referencedNotes.contains(nn) {
                notesName = nil // that notes file belongs to another slide
            }
            if let notesName, let nx = try zip.data(for: notesName) {
                let notes = OOXMLWalker.parse(nx, para: "a:p", text: "a:t", shape: "p:sp")
                    .filter { !["sldNum", "sldImg", "dt", "ftr", "hdr"].contains($0.placeholder ?? "") }
                    .map(\.text)
                    .filter { Int($0) == nil }
                lines += notes
            }
            let body = lines.joined(separator: "\n")
            let total = TextKit.wordCount(body + " " + heading)
            guard total >= 3 else { continue }
            pages.append(ExtractedPage(text: body.isEmpty ? heading : body, heading: heading.isEmpty ? nil : heading, index: i + 1))
        }
        return ExtractedDoc(title: coreTitle(zip), pages: pages)
    }

    // MARK: DOCX

    public static func docx(_ data: Data) throws -> ExtractedDoc {
        let zip = try ZipArchive(data: data)
        guard let xml = try zip.data(for: "word/document.xml") else { throw ZipArchive.ZipError.corrupt }
        let paras = OOXMLWalker.parse(xml, para: "w:p", text: "w:t", shape: nil)
        var title = coreTitle(zip)
        var blocks: [(heading: String?, lines: [String])] = []
        func isHeading(_ s: String?) -> Bool {
            guard let s = s?.lowercased() else { return false }
            return ["heading1", "heading2", "heading3", "title", "heading 1", "heading 2", "heading 3"].contains(s)
        }
        for p in paras {
            if isHeading(p.style) {
                if p.style?.lowercased() == "title", title == nil { title = p.text; continue }
                blocks.append((p.text, []))
            } else {
                if blocks.isEmpty { blocks.append((nil, [])) }
                blocks[blocks.count - 1].lines.append(p.text)
            }
        }
        let hasHeadings = blocks.contains { $0.heading != nil }
        var pages: [ExtractedPage] = []
        if hasHeadings {
            for b in blocks {
                let text = b.lines.joined(separator: "\n")
                guard TextKit.wordCount(text) + TextKit.wordCount(b.heading ?? "") >= 3 else { continue }
                pages.append(ExtractedPage(text: text.isEmpty ? (b.heading ?? "") : text, heading: b.heading, index: pages.count + 1))
            }
        } else {
            pages = chunkByWords(blocks.flatMap(\.lines), size: 250)
        }
        return ExtractedDoc(title: title, pages: pages)
    }

    static func chunkByWords(_ lines: [String], size: Int) -> [ExtractedPage] {
        var out: [ExtractedPage] = []
        var cur: [String] = []
        var count = 0
        for l in lines {
            cur.append(l); count += TextKit.wordCount(l)
            if count >= size { out.append(ExtractedPage(text: cur.joined(separator: "\n"), index: out.count + 1)); cur = []; count = 0 }
        }
        if !cur.isEmpty, TextKit.wordCount(cur.joined(separator: " ")) >= 3 { out.append(ExtractedPage(text: cur.joined(separator: "\n"), index: out.count + 1)) }
        return out
    }

    // MARK: Markdown / HTML / plain text

    /// Markdown `#` headings (levels 1..3) are section boundaries. Returns nil when there are no headings.
    public static func markdownSections(_ text: String) -> ExtractedDoc? {
        var blocks: [(heading: String?, lines: [String])] = []
        var title: String?
        var sawHeading = false
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if let r = line.range(of: "^#{1,3}\\s+", options: .regularExpression) {
                let h = String(line[r.upperBound...]).trimmingCharacters(in: .whitespaces)
                sawHeading = true
                if line.hasPrefix("# "), title == nil, blocks.allSatisfy({ $0.lines.isEmpty }) { title = h }
                blocks.append((h, []))
            } else if !line.isEmpty {
                if blocks.isEmpty { blocks.append((nil, [])) }
                let clean = line.replacingOccurrences(of: "^([-*\u{2022}]|\\d+[.)])\\s+", with: "", options: .regularExpression)
                blocks[blocks.count - 1].lines.append(clean)
            }
        }
        guard sawHeading else { return nil }
        var pages: [ExtractedPage] = []
        for b in blocks {
            let t = b.lines.joined(separator: "\n")
            guard TextKit.wordCount(t) >= 3 else { continue }
            pages.append(ExtractedPage(text: t, heading: b.heading, index: pages.count + 1))
        }
        return ExtractedDoc(title: title, pages: pages)
    }

    /// HTML: `<h1-3>` become markdown headings, then tags are stripped.
    public static func htmlToMarkdown(_ html: String) -> String {
        var t = html.replacingOccurrences(of: "(?is)<(script|style)[^>]*>.*?</\\1>", with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: "(?i)<h([1-3])[^>]*>", with: "\n\n# ", options: .regularExpression)
        t = t.replacingOccurrences(of: "(?i)</h[1-3]>", with: "\n\n", options: .regularExpression)
        t = t.replacingOccurrences(of: "(?i)<li[^>]*>", with: "\n- ", options: .regularExpression)
        return TextKit.stripHTML(t)
    }

    /// Cleans a file name into a title: drops the extension, "lecture/week/lec/slides/notes" + numbers, underscores.
    public static func cleanFileName(_ name: String) -> String {
        var t = (name as NSString).deletingPathExtension
        t = t.replacingOccurrences(of: "[_]+", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "(?i)\\b(lecture|lec|week|wk|slides?|notes?|chapter|ch|unit|part)\\s*[-#.]?\\s*\\d+[a-z]?\\b", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "(?i)\\b(lecture|slides|notes)\\b", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "^[\\s\\-:.,0-9]+|[\\s\\-:.,]+$", with: "", options: .regularExpression)
        t = TextKit.collapseWhitespace(t)
        return t.isEmpty ? (name as NSString).deletingPathExtension : t
    }

    /// Re-joins lines that a PDF wrapped mid-sentence: a line that does not end a sentence or a label,
    /// followed by a line starting in lowercase, continues on the same line.
    public static func unwrapLines(_ text: String) -> String {
        var out: [String] = []
        for raw in text.components(separatedBy: .newlines) {
            let l = raw.trimmingCharacters(in: .whitespaces)
            if let last = out.last, !last.isEmpty, !l.isEmpty, let f = l.first, f.isLowercase,
               let e = last.last, !".?!:;".contains(e) {
                out[out.count - 1] = last.hasSuffix("-") ? String(last.dropLast()) + l : last + " " + l
            } else { out.append(l) }
        }
        return out.joined(separator: "\n")
    }

    /// First short line (< 80 chars, no ending period).
    public static func guessHeading(_ text: String) -> String? {
        for line in text.components(separatedBy: .newlines) {
            let l = line.trimmingCharacters(in: .whitespaces)
            if l.isEmpty { continue }
            if l.count < 80 && !l.hasSuffix(".") && TextKit.wordCount(l) <= 10 && l.contains(where: \.isLetter) { return l }
            return nil
        }
        return nil
    }
}

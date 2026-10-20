import Foundation

// MARK: - Definition detection (spec 8.4)

public struct Definition: Equatable {
    public var term: String
    public var definition: String
    public var source: String
}

public enum DefinitionDetector {
    static let starts: Set<String> = ["it", "this", "that", "there", "these", "those", "he", "she", "they", "we", "you", "i", "what", "which", "who", "here", "one", "all", "each", "some", "most", "many", "such", "if", "when", "so", "but", "and", "or"]

    static let sepPattern = try! NSRegularExpression(pattern: "^([^:=]{1,60}?)\\s*(?::|=|\\s[-\u{2013}]\\s)\\s*(.+)$")
    static let verbPattern = try! NSRegularExpression(pattern: "^((?:the |an? )?[A-Za-z][\\w'\\- ]{0,50}?)(\\s*\\([^)]{1,15}\\))?\\s+(is|are|means|refers to)\\s+(.+)$", options: [.caseInsensitive])

    /// Detects "Term: definition", "Term - definition", "Term = definition", "Term is/are/means/refers to definition",
    /// "Term (abbr) is ...". Term 1..5 words, definition 4..40 words.
    public static func detect(_ raw: String) -> Definition? {
        let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "^([-*\u{2022}]|\\d+[.)])\\s+", with: "", options: .regularExpression)
        guard !line.isEmpty else { return nil }
        let ns = line as NSString
        let range = NSRange(location: 0, length: ns.length)
        var term: String?
        var def: String?
        if let m = sepPattern.firstMatch(in: line, range: range) {
            term = ns.substring(with: m.range(at: 1)); def = ns.substring(with: m.range(at: 2))
        } else if let m = verbPattern.firstMatch(in: line, range: range) {
            term = ns.substring(with: m.range(at: 1)); def = ns.substring(with: m.range(at: 4))
        }
        guard var t = term?.trimmingCharacters(in: .whitespaces), var d = def?.trimmingCharacters(in: .whitespaces) else { return nil }
        t = t.replacingOccurrences(of: "^(the|an?)\\s+", with: "", options: [.regularExpression, .caseInsensitive])
        t = t.trimmingCharacters(in: CharacterSet(charactersIn: "*_\"'\u{201C}\u{201D} "))
        let tw = TextKit.words(t)
        guard (1...5).contains(tw.count), let first = tw.first?.lowercased(), !starts.contains(first),
              t.first?.isLetter == true, !t.contains(where: { ".?!,;".contains($0) }) else { return nil }
        // Terms are noun-like: reject clauses that read like sentences ("Criticism works").
        if tw.count > 1, tw.dropFirst().contains(where: { TextKit.isStop($0.lowercased()) && !["of", "and", "in"].contains($0.lowercased()) }) { return nil }
        d = d.trimmingCharacters(in: CharacterSet(charactersIn: " .;"))
        let dw = TextKit.wordCount(d)
        guard (4...40).contains(dw) else { return nil }
        let displayTerm = t.prefix(1).uppercased() + t.dropFirst()
        let displayDef = d.prefix(1).uppercased() + d.dropFirst()
        return Definition(term: displayTerm, definition: displayDef, source: line)
    }

    /// All definitions in a text, line by line and sentence by sentence.
    public static func all(in text: String) -> [Definition] {
        var out: [Definition] = []
        var seen = Set<String>()
        for line in text.components(separatedBy: .newlines) {
            let pieces = WebText.splitSentences(line)
            for s in (pieces.isEmpty ? [line] : pieces) {
                if let d = detect(s), seen.insert(d.term.lowercased()).inserted { out.append(d) }
            }
        }
        return out
    }
}

// MARK: - Class lessons (spec 8.4)

public enum ClassBuilder {
    public struct Unit { public var name: String; public var title: String; public var pages: [Page] }

    /// Sentences for class material: each line of >= 4 words is a sentence even without a period.
    public static func sentences(_ text: String) -> [String] {
        var out: [String] = []
        for line in text.components(separatedBy: .newlines) {
            let l = line.trimmingCharacters(in: .whitespaces)
                .replacingOccurrences(of: "^([-*\u{2022}]|\\d+[.)])\\s+", with: "", options: .regularExpression)
            guard TextKit.wordCount(l) >= 4 else { continue }
            let parts = WebText.splitSentences(l).filter { TextKit.wordCount($0) >= 4 }
            out += parts.isEmpty ? [l] : parts
        }
        return out
    }

    /// Lesson title for a file: "Lecture 4: Enzymes" -> "Enzymes".
    public static func fileTitle(_ name: String) -> String { DocumentParser.cleanFileName(name) }

    static let generic: Set<String> = ["reading", "notes", "handout", "scan", "document", "untitled", "slides", "lecture", "doc", "file", "img", "image", "page"]

    /// File title: metadata title, else the cleaned file name, else the first-page heading when the name is generic.
    /// Course codes and "Lecture N:" style prefixes are dropped.
    public static func unitTitle(name: String, pages: [Page]) -> String {
        func strip(_ s: String) -> String {
            var t = s.replacingOccurrences(of: "\\s*\\([^)]*\\)", with: "", options: .regularExpression)
            t = t.replacingOccurrences(of: "\\b[A-Z]{2,5}\\s?-?\\d{2,4}[A-Z]?\\b[:\\s-]*", with: "", options: .regularExpression)
            t = DocumentParser.cleanFileName(t + ".x")
            if let r = t.range(of: ":", options: .backwards) {
                let after = t[r.upperBound...].trimmingCharacters(in: .whitespaces)
                if !after.isEmpty { t = after }
            }
            return t.trimmingCharacters(in: CharacterSet(charactersIn: " -:"))
        }
        if let meta = pages.first?.header, !strip(meta).isEmpty { return strip(meta) }
        let fromName = strip((name as NSString).deletingPathExtension)
        let words = TextKit.words(fromName.lowercased())
        if !fromName.isEmpty, !words.allSatisfy({ generic.contains($0) || Int($0) != nil }) { return fromName }
        if let h = pages.first?.heading, !strip(h).isEmpty { return strip(h) }
        return fromName.isEmpty ? DocumentParser.cleanFileName(name) : fromName
    }

    static func firstNumber(_ s: String) -> Int? {
        guard let r = s.range(of: "\\d+", options: .regularExpression) else { return nil }
        return Int(s[r])
    }

    /// Source files in order: by any number in the file name, else import order.
    public static func units(_ pages: [Page]) -> [Unit] {
        var order: [String] = []
        var by: [String: [Page]] = [:]
        for p in pages {
            let key = p.sourceName ?? "\u{0}notes"
            if by[key] == nil { order.append(key) }
            by[key, default: []].append(p)
        }
        let indexed = order.enumerated().map { ($0.offset, $0.element) }
        let sorted = indexed.sorted { a, b in
            let na = firstNumber(a.1), nb = firstNumber(b.1)
            if let na, let nb, na != nb { return na < nb }
            if (na == nil) != (nb == nil) { return na != nil }
            return a.0 < b.0
        }.map(\.1)
        return sorted.map { key in
            let ps = by[key]!.sorted { ($0.sourceIndex ?? 0, $0.createdAt) < ($1.sourceIndex ?? 0, $1.createdAt) }
            let title = key == "\u{0}notes" ? "Notes" : unitTitle(name: key, pages: ps)
            return Unit(name: key, title: title, pages: ps)
        }
    }

    struct Section { var title: String; var pages: [Page]; var sentences: [(text: String, pageId: String)] }

    static func sentencesOf(_ pages: [Page]) -> [(text: String, pageId: String)] {
        pages.flatMap { p in sentences(p.text).map { ($0, p.id) } }
    }

    /// Splits pages by heading: consecutive equal headings merge, sections < 3 sentences merge into the previous.
    static func headingSections(_ pages: [Page], prefix: String?) -> [Section] {
        var secs: [Section] = []
        for p in pages {
            let h = (p.heading ?? "").trimmingCharacters(in: .whitespaces)
            let s = sentencesOf([p])
            if let last = secs.last, (h.isEmpty || h.lowercased() == last.title.lowercased()) {
                secs[secs.count - 1].pages.append(p); secs[secs.count - 1].sentences += s
            } else {
                secs.append(Section(title: h.isEmpty ? (prefix ?? "Key Ideas") : h, pages: [p], sentences: s))
            }
        }
        var merged: [Section] = []
        for s in secs {
            if s.sentences.count < 3, !merged.isEmpty {
                merged[merged.count - 1].pages += s.pages; merged[merged.count - 1].sentences += s.sentences
            } else { merged.append(s) }
        }
        if merged.count > 1, merged[0].sentences.count < 3 {
            let first = merged.removeFirst()
            merged[0].pages = first.pages + merged[0].pages; merged[0].sentences = first.sentences + merged[0].sentences
            merged[0].title = first.title
        }
        if let p = prefix { for i in merged.indices { merged[i].title = merged[i].title == p ? p : "\(p): \(merged[i].title)" } }
        return merged
    }

    public static func build(pages: [Page], title: String? = nil, author: String? = nil) -> BuildResult {
        let units = units(pages)
        var sections: [Section] = []
        if units.count >= 2 {
            for u in units {
                let s = sentencesOf(u.pages)
                if s.count > 30, u.pages.contains(where: { !($0.heading ?? "").isEmpty }) {
                    let parts = headingSections(u.pages, prefix: u.title)
                    sections += parts.count > 1 ? parts : [Section(title: u.title, pages: u.pages, sentences: s)]
                } else {
                    sections.append(Section(title: u.title, pages: u.pages, sentences: s))
                }
            }
        } else if pages.contains(where: { !($0.heading ?? "").isEmpty }) {
            sections = headingSections(units.first?.pages ?? pages, prefix: nil)
        } else {
            // Fallback: k-means themes (section 4) with definition cards added on top.
            let r = LessonBuilder.build(pages: pages, title: title, author: author)
            return withDefinitions(r, pages: pages)
        }
        sections = sections.filter { !$0.sentences.isEmpty }

        // Definitions per section, plus project-wide terms for distractors.
        let defsPer: [[(Definition, String)]] = sections.map { sec in
            var seen = Set<String>()
            var out: [(Definition, String)] = []
            for p in sec.pages {
                for d in DefinitionDetector.all(in: p.text) where seen.insert(d.term.lowercased()).inserted { out.append((d, p.id)) }
            }
            return Array(out.prefix(20))
        }
        let allDefs = defsPer.flatMap { $0 }.map(\.0)

        // Cloze facts via the shared builder over each section's non-definition sentences.
        var used = Set<String>()
        var lessons: [BuiltLesson] = []
        for (i, sec) in sections.enumerated() {
            var cards = defsPer[i].map { definitionCard($0.0, pageId: $0.1, all: allDefs) }
            let defSources = Set(defsPer[i].map { TextKit.normalizeKey($0.0.source) })
            let rest = sec.sentences.filter { !defSources.contains(TextKit.normalizeKey($0.text)) && DefinitionDetector.detect($0.text) == nil }
            if cards.count < 24, !rest.isEmpty {
                let fake = rest.map { Page(id: $0.pageId, kind: "note", text: $0.text.hasSuffix(".") ? $0.text : $0.text + ".") }
                let facts = LessonBuilder.build(pages: mergePages(fake)).lessons.flatMap(\.cards)
                for f in facts where cards.count < 24 && !cards.contains(where: { $0.statement == f.statement }) { cards.append(f) }
            }
            guard !cards.isEmpty else { continue }
            var t = sec.title
            var n = 2
            while used.contains(t) { t = "\(sec.title) \(n)"; n += 1 }
            used.insert(t)
            let summary: String
            if !defsPer[i].isEmpty {
                summary = TextKit.truncate("Key terms: " + defsPer[i].prefix(4).map(\.0.term).joined(separator: ", "), 120)
            } else {
                summary = TextKit.truncate(sec.sentences.first?.text ?? "", 120)
            }
            lessons.append(BuiltLesson(title: t, summary: summary, cards: cards))
        }
        return BuildResult(lessons: lessons, quotes: LessonBuilder.quoteCandidates(pages: pages.filter { $0.verbatim == true }, author: author))
    }

    /// Joins sentences back into one text per page so the builder keeps page ids.
    static func mergePages(_ pages: [Page]) -> [Page] {
        var order: [String] = []
        var texts: [String: [String]] = [:]
        for p in pages { if texts[p.id] == nil { order.append(p.id) }; texts[p.id, default: []].append(p.text) }
        return order.map { Page(id: $0, kind: "note", text: texts[$0]!.joined(separator: " ")) }
    }

    static func lowerFirst(_ s: String) -> String { s.prefix(1).lowercased() + String(s.dropFirst()) }

    static func definitionCard(_ d: Definition, pageId: String, all: [Definition]) -> BuiltCard {
        let others = all.filter { $0.term.lowercased() != d.term.lowercased() }
        let n = d.term.count
        let distractors: [String] = others.map(\.term).sorted { (a: String, b: String) -> Bool in
            let da = abs(a.count - n), db = abs(b.count - n)
            return da != db ? da < db : a < b
        }
        let defLower: String = lowerFirst(d.definition)
        let statement = "\(d.term): \(defLower)."
        let falseDef: String? = others.first.map { lowerFirst($0.definition) }
        return BuiltCard(pageId: pageId, statement: statement, cloze: d.term, question: "What is \(d.term)?", answer: d.term,
                         distractors: Array(distractors.prefix(3)), falseStatement: falseDef.map { "\(d.term): \($0)." } ?? statement,
                         term: d.term, definition: d.definition)
    }

    /// Adds definition cards in front of k-means lessons (single file without headings).
    static func withDefinitions(_ r: BuildResult, pages: [Page]) -> BuildResult {
        var defs: [(Definition, String)] = []
        var seen = Set<String>()
        for p in pages { for d in DefinitionDetector.all(in: p.text) where seen.insert(d.term.lowercased()).inserted { defs.append((d, p.id)) } }
        guard !defs.isEmpty else { return r }
        let all = defs.map(\.0)
        var lessons = r.lessons
        if lessons.isEmpty { lessons = [BuiltLesson(title: "Key Terms", summary: "", cards: [])] }
        // Put each definition in the lesson that already holds a card from its page, else the first.
        for (d, pid) in defs {
            let li = lessons.firstIndex { $0.cards.contains { $0.pageId == pid } } ?? 0
            guard lessons[li].cards.filter({ $0.term != nil }).count < 20 else { continue }
            let card = definitionCard(d, pageId: pid, all: all)
            lessons[li].cards.removeAll { TextKit.normalizeKey($0.statement).contains(TextKit.normalizeKey(d.term)) && $0.term == nil && TextKit.normalizeKey($0.statement).contains(TextKit.normalizeKey(String(d.definition.prefix(20)))) }
            lessons[li].cards.insert(card, at: lessons[li].cards.filter { $0.term != nil }.count)
            if lessons[li].cards.count > 24 { lessons[li].cards.removeLast(lessons[li].cards.count - 24) }
        }
        if lessons[0].summary.isEmpty { lessons[0].summary = TextKit.truncate("Key terms: " + all.prefix(4).map(\.term).joined(separator: ", "), 120) }
        return BuildResult(lessons: lessons, quotes: r.quotes)
    }
}

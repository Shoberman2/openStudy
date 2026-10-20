import Foundation

// MARK: - Word lists (spec 10.2, ported from BookSaver words.ts)

public struct WordListParse: Equatable {
    public var isWordList: Bool
    public var words: [WordEntry]
}

public enum WordList {
    static let bullet = try! NSRegularExpression(pattern: "^\\s*(?:(?:[-*\u{2022}\u{00B7}\u{25AA}\u{25E6}\u{2013}\u{2014}]|\\d{1,4}[.)]|\\[[ xX]?\\])\\s+)+")
    static let separator = try! NSRegularExpression(pattern: "\\s+[-\u{2013}\u{2014}=]+\\s+|\\s*:\\s+|\\s*[\u{2013}\u{2014}]\\s*|\\t+")
    static let vocab = try! NSRegularExpression(pattern: "\\b(words?|vocab(ulary)?|terms?|glossary|definitions?)\\b", options: [.caseInsensitive])
    static let termShape = try! NSRegularExpression(pattern: "^[\\p{L}][\\p{L}'\u{2019}\\- ]*$")

    static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }

    static func cleanTerm(_ raw: String) -> String {
        var t = raw.replacingOccurrences(of: "^[\"'\u{201C}\u{2018}(]+", with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: "[\"'\u{201D}\u{2019}),.;]+$", with: "", options: .regularExpression)
        return TextKit.collapseWhitespace(t)
    }

    /// A plausible vocabulary term: 2..48 chars, <= 4 words, letters only.
    public static func isTermLike(_ term: String) -> Bool {
        let n = (term as NSString).length
        guard n >= 2, n <= 48, TextKit.words(term).count <= 4 else { return false }
        return matches(termShape, term)
    }

    /// One line to an entry, or nil when the line is not a word entry.
    public static func parseLine(_ line: String) -> WordEntry? {
        let ns = line as NSString
        let stripped = bullet.stringByReplacingMatches(in: line, range: NSRange(location: 0, length: ns.length), withTemplate: "")
            .trimmingCharacters(in: .whitespaces)
        guard !stripped.isEmpty else { return nil }
        let s = stripped as NSString
        if let m = separator.firstMatch(in: stripped, range: NSRange(location: 0, length: s.length)) {
            let term = cleanTerm(s.substring(to: m.range.location))
            let def = s.substring(from: m.range.location + m.range.length).trimmingCharacters(in: .whitespaces)
            return isTermLike(term) ? WordEntry(term: term, definition: def.isEmpty ? nil : def) : nil
        }
        let term = cleanTerm(stripped)
        return isTermLike(term) ? WordEntry(term: term) : nil
    }

    static func stripBullet(_ line: String) -> String {
        bullet.stringByReplacingMatches(in: line, range: NSRange(location: 0, length: (line as NSString).length), withTemplate: "")
    }

    /// A definition that wrapped onto the next line (photos, narrow notes): no bullet, no separator,
    /// starts lowercase, and has >= 2 words or follows a definition ending on a stopword ("too eager to" / "please").
    static func isWrappedLine(_ line: String, after definition: String) -> Bool {
        guard !matches(bullet, line), !matches(separator, line), let f = line.unicodeScalars.first,
              CharacterSet.lowercaseLetters.contains(f) else { return false }
        let lastWord = (definition.split(separator: " ").last.map(String.init) ?? "").lowercased()
            .replacingOccurrences(of: "[^\\p{L}']", with: "", options: .regularExpression)
        return TextKit.words(line).count >= 2 || TextKit.stopwords.contains(lastWord)
    }

    /// Decides whether a text block (a note, a paste, a file, an OCR'd photo) is a word list.
    public static func parse(_ text: String, title: String? = nil) -> WordListParse {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        var words: [WordEntry] = []
        var index: [String: Int] = [:]
        var entryLines = 0
        var candidates = lines.count
        var vocabHeading = matches(vocab, title ?? "")
        var last: Int?
        for (i, line) in lines.enumerated() {
            if i == 0, !matches(separator, stripBullet(line)) && matches(vocab, line)
                || TextKit.words(line).count >= 2 && line.hasSuffix(":") {
                candidates -= 1
                if matches(vocab, line) { vocabHeading = true }
                continue
            }
            if let at = last, let d = words[at].definition, isWrappedLine(line, after: d) {
                words[at].definition = d + " " + line
                entryLines += 1
                continue
            }
            last = nil
            guard let e = parseLine(line) else { continue }
            entryLines += 1
            let k = e.term.lowercased()
            if let at = index[k] {
                if words[at].definition == nil, let d = e.definition { words[at].definition = d }
                last = at
                continue
            }
            index[k] = words.count
            last = words.count
            words.append(e)
        }
        let defined = words.filter { $0.definition != nil }.count
        let isList = Grouper.courseCode(in: (title ?? "") + "\n" + text) == nil
            && words.count >= 2
            && candidates > 0 && Double(entryLines) / Double(candidates) >= 0.7
            && (Double(defined) >= 0.5 * Double(words.count) || vocabHeading)
        return WordListParse(isWordList: isList, words: isList ? words : [])
    }

    /// The original non-empty lines, one per line (the page text of a word-list page).
    public static func pageText(_ text: String) -> String {
        text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: "\n")
    }

    static func upperFirst(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    /// Word lessons (spec 10.2): defined entries become definition cards, 12 per lesson, "<First> to <Last>".
    public static func lessons(_ pages: [Page]) -> [BuiltLesson] {
        var seen = Set<String>()
        var defs: [(Definition, String)] = []
        for p in pages {
            for w in p.words ?? [] where seen.insert(w.term.lowercased()).inserted {
                if let d = w.definition, !d.trimmingCharacters(in: .whitespaces).isEmpty {
                    defs.append((Definition(term: w.term, definition: d, source: ""), p.id))
                }
            }
        }
        let all = defs.map(\.0)
        return stride(from: 0, to: defs.count, by: 12).map { start in
            let chunk = Array(defs[start..<min(defs.count, start + 12)])
            let cards = chunk.map { ClassBuilder.definitionCard($0.0, pageId: $0.1, all: all) }
            return BuiltLesson(title: lessonTitle(chunk.map(\.0.term)), summary: summary(cards.count), cards: cards)
        }
    }

    public static func summary(_ n: Int) -> String { "\(n) \(n == 1 ? "word" : "words") from your list." }

    public static func lessonTitle(_ terms: [String]) -> String {
        guard let f = terms.first else { return "Words" }
        return terms.count == 1 ? upperFirst(f) : "\(upperFirst(f)) to \(upperFirst(terms.last!))"
    }
}

// MARK: - Words to define (spec 10.2)

public extension Library {
    /// Word entries in a project that have no definition yet (first occurrence of each term).
    func undefinedWords(of projectId: String) -> [(pageId: String, term: String)] {
        let carded = Set(cards(ofProject: projectId).compactMap { $0.term?.lowercased() })
        var seen = Set<String>()
        var out: [(pageId: String, term: String)] = []
        for p in pages(of: projectId) {
            for w in p.words ?? [] {
                let k = w.term.lowercased()
                guard seen.insert(k).inserted else { continue }
                if (w.definition ?? "").trimmingCharacters(in: .whitespaces).isEmpty && !carded.contains(k) { out.append((p.id, w.term)) }
            }
        }
        return out
    }

    /// Fills definitions on word entries (any page) without making cards. Returns how many were filled.
    @discardableResult
    mutating func applyDefinitions(_ defs: [String: String], pageIds: Set<String>) -> Int {
        var n = 0
        for i in pages.indices where pageIds.contains(pages[i].id) {
            guard var ws = pages[i].words else { continue }
            for j in ws.indices where (ws[j].definition ?? "").isEmpty {
                if let d = defs[ws[j].term.lowercased()]?.trimmingCharacters(in: .whitespacesAndNewlines), !d.isEmpty { ws[j].definition = d; n += 1 }
            }
            pages[i].words = ws
        }
        return n
    }

    /// Saves a definition the user typed and adds its card to the last word lesson (a new one when it has 12).
    mutating func defineWord(pageId: String, term: String, definition: String, now: Date = Date()) {
        let d = definition.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !d.isEmpty, let pi = pages.firstIndex(where: { $0.id == pageId }), let projectId = pages[pi].projectId,
              let project = project(projectId), var ws = pages[pi].words,
              let wi = ws.firstIndex(where: { $0.term.lowercased() == term.lowercased() }) else { return }
        ws[wi].definition = d
        pages[pi].words = ws
        let wordPageIds = Set(pages(of: projectId).filter { !($0.words ?? []).isEmpty }.map(\.id))
        let wordLessons = lessons(of: projectId).filter { l in
            !l.isQuotes && cards(of: l.id).contains { $0.term != nil && ($0.pageId.map(wordPageIds.contains) ?? false) }
        }
        let all = cards(ofProject: projectId).filter(\.isDefinition).map { Definition(term: $0.term!, definition: $0.definition!, source: "") }
        let def = Definition(term: ws[wi].term, definition: d, source: "")
        let built = ClassBuilder.definitionCard(def, pageId: pageId, all: all + [def])
        var lesson = wordLessons.last
        if lesson == nil || cards(of: lesson!.id).count >= 12 {
            let order = (lessons(of: projectId).map(\.order).max() ?? -1) + 1
            let l = Lesson(projectId: projectId, title: WordList.lessonTitle([ws[wi].term]), summary: WordList.summary(1), order: order)
            lessons.append(l)
            lesson = l
        } else if let li = lessons.firstIndex(where: { $0.id == lesson!.id }) {
            // Spec 10.10: "<first card term> to <new term>".
            let first = cards(of: lesson!.id).first { $0.term != nil }?.term ?? ws[wi].term
            lessons[li].title = WordList.lessonTitle([first, ws[wi].term])
            lessons[li].summary = WordList.summary(cards(of: lesson!.id).count + 1)
        }
        cards.append(Card(lessonId: lesson!.id, projectId: project.id, pageId: pageId, kind: "fact", statement: built.statement,
                          cloze: built.cloze, question: built.question, answer: built.answer, distractors: built.distractors,
                          falseStatement: built.falseStatement, term: built.term, definition: built.definition, srs: .fresh(now: now)))
    }
}

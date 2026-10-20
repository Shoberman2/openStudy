import Foundation

// MARK: - What we found (spec 10.6)

public extension Grouper {
    static let looseNotes = "Loose notes"
    static let words = "Words"

    /// "Looks like 6 books, 2 classes, 3 topics and 1 word list. 4 pages still need a home."
    static func detectionSummary(_ groups: [SuggestedGroup]) -> String {
        func n(_ c: Int, _ one: String, _ many: String) -> String { "\(c) \(c == 1 ? one : many)" }
        let placed = groups.filter { $0.title != unsorted && $0.title != looseNotes }
        let left = groups.filter { $0.title == unsorted || $0.title == looseNotes }.reduce(0) { $0 + $1.pageIds.count }
        let isWords = { (g: SuggestedGroup) in g.title == words }
        let counts = [
            (placed.filter { !isWords($0) && $0.type == "book" }.count, "book", "books"),
            (placed.filter { !isWords($0) && $0.type == "class" }.count, "class", "classes"),
            (placed.filter { !isWords($0) && $0.type != "book" && $0.type != "class" }.count, "topic", "topics"),
            (placed.filter(isWords).count, "word list", "word lists"),
        ].filter { $0.0 > 0 }.map { n($0.0, $0.1, $0.2) }
        let rest = left > 0 ? "\(left) \(left == 1 ? "page still needs" : "pages still need") a home." : ""
        guard !counts.isEmpty else { return rest.isEmpty ? "Nothing to sort yet." : rest }
        let list = counts.count == 1 ? counts[0] : counts.dropLast().joined(separator: ", ") + " and " + counts.last!
        return "Looks like \(list)." + (rest.isEmpty ? "" : " " + rest)
    }
}

// MARK: - Ask your notes (spec 10.7)

public struct AskQuote: Equatable, Hashable {
    public var text: String
    public var pageId: String
}

public enum AskEngine {
    /// TF-IDF where every page is one document; the question uses the same idf.
    struct Index {
        var idf: [String: Double]
        var vecs: [OVec]
        func vector(_ text: String) -> OVec {
            let toks = WebText.tokens(text).map(\.stem)
            var tf = OVec()
            for t in toks { tf.add(t, 1) }
            var v = OVec()
            for k in tf.keys { v.add(k, (tf.map[k]! / Double(max(1, toks.count))) * (idf[k] ?? missingIdf)) }
            return v
        }
        var missingIdf: Double
    }

    static func index(_ pages: [Page]) -> Index {
        let docs = pages.map { WebText.tokens($0.text).map(\.stem) }
        var df: [String: Int] = [:]
        for d in docs { for t in Set(d) { df[t, default: 0] += 1 } }
        let n = Double(docs.count)
        let idf = df.mapValues { log((1 + n) / (1 + Double($0))) + 1 }
        return Index(idf: idf, vecs: WebText.tfidf(docs), missingIdf: log(1 + n) + 1)
    }

    /// Pages with score > 0, best first (ties: earlier page), at most k.
    public static func retrieve(_ question: String, pages: [Page], k: Int = 6) -> [(page: Page, score: Double)] {
        guard !pages.isEmpty else { return [] }
        let ix = index(pages)
        let q = ix.vector(question)
        var scored: [(page: Page, score: Double, i: Int)] = []
        for (i, p) in pages.enumerated() {
            let s = q.cosine(ix.vecs[i])
            if s > 0 { scored.append((p, s, i)) }
        }
        scored.sort { a, b in a.score != b.score ? a.score > b.score : a.i < b.i }
        return scored.prefix(k).map { (page: $0.page, score: $0.score) }
    }

    /// Offline answer: the 3 sentences closest to the question (max 2 per page) from the top pages.
    public static func localAnswer(_ question: String, pages: [Page], k: Int = 6) -> [AskQuote] {
        let top = retrieve(question, pages: pages, k: k)
        guard !top.isEmpty else { return [] }
        let ix = index(pages)
        let q = ix.vector(question)
        var cands: [(AskQuote, Double, Int)] = []
        for (i, t) in top.enumerated() {
            for s in WebText.splitSentences(t.page.text) {
                let n = TextKit.wordCount(s)
                guard n >= 5, n <= 60 else { continue }
                let c = q.cosine(ix.vector(s))
                if c > 0 { cands.append((AskQuote(text: s, pageId: t.page.id), c, i * 1000 + cands.count)) }
            }
        }
        if cands.isEmpty {
            // Spec 10.10: no usable sentence, show the top page cut to 280 chars.
            return [AskQuote(text: TextKit.truncate(TextKit.collapseWhitespace(top[0].page.text), 280), pageId: top[0].page.id)]
        }
        var perPage: [String: Int] = [:]
        var out: [AskQuote] = []
        for c in cands.sorted(by: { $0.1 != $1.1 ? $0.1 > $1.1 : $0.2 < $1.2 }) where out.count < 3 {
            if perPage[c.0.pageId, default: 0] >= 2 { continue }
            perPage[c.0.pageId, default: 0] += 1
            out.append(c.0)
        }
        return out
    }

    static func normQuote(_ s: String) -> String {
        var t = s
        for (k, v) in [("\u{201C}", "\""), ("\u{201D}", "\""), ("\u{201E}", "\""), ("\u{2018}", "'"), ("\u{2019}", "'")] { t = t.replacingOccurrences(of: k, with: v) }
        return TextKit.collapseWhitespace(t)
    }

    /// The quote appears word for word in the source (whitespace runs and curly quotes normalized).
    public static func isVerbatim(_ quote: String, in source: String) -> Bool {
        let q = normQuote(quote)
        guard q.count >= 3 else { return false }
        return normQuote(source).contains(q)
    }
}

// MARK: - Connections across projects (spec 10.8)

public struct ConnectionLesson {
    public var id: String
    public var projectId: String
    public var title: String
    public var statements: [String]
    public init(id: String, projectId: String, title: String, statements: [String]) {
        self.id = id; self.projectId = projectId; self.title = title; self.statements = statements
    }
}

public struct Connection: Equatable, Identifiable {
    public var projects: [String]
    public var lessons: [String]
    public var terms: [String]
    public var score: Double
    public var id: String { lessons.joined(separator: "+") }
}

public enum Connections {
    public static func find(_ lessons: [ConnectionLesson], limit: Int = 3) -> [Connection] {
        let toks = lessons.map { l in l.statements.flatMap { WebText.tokens($0) } }
        let vecs = WebText.tfidf(toks.map { $0.map(\.stem) })
        var best: [String: (Connection, Int)] = [:]
        var order = 0
        for i in lessons.indices {
            for j in lessons.indices where j > i && lessons[i].projectId != lessons[j].projectId {
                let c = vecs[i].cosine(vecs[j])
                guard c >= 0.15 else { continue }
                let key = [lessons[i].projectId, lessons[j].projectId].sorted().joined(separator: "|")
                if let b = best[key], b.0.score >= c { continue }
                let shared = vecs[i].keys.filter { vecs[j].map[$0] != nil }
                    .enumerated()
                    .sorted { a, b in
                        let x = vecs[i].map[a.element]! * vecs[j].map[a.element]!, y = vecs[i].map[b.element]! * vecs[j].map[b.element]!
                        return x != y ? x > y : a.offset < b.offset
                    }.prefix(3).map(\.element)
                let surfaces = toks[i] + toks[j]
                let terms = shared.map { stem -> String in
                    let counts = Dictionary(grouping: surfaces.filter { $0.stem == stem }.map(\.surface), by: { $0 }).mapValues(\.count)
                    return counts.max { $0.value != $1.value ? $0.value < $1.value : $0.key > $1.key }?.key ?? stem
                }
                best[key] = (Connection(projects: [lessons[i].projectId, lessons[j].projectId], lessons: [lessons[i].id, lessons[j].id], terms: terms, score: c), best[key]?.1 ?? order)
                order += 1
            }
        }
        return best.values.sorted { $0.0.score != $1.0.score ? $0.0.score > $1.0.score : $0.1 < $1.1 }.prefix(limit).map(\.0)
    }

    /// "<A> and <B> both cover <t1>, <t2> and <t3>."
    public static func sentence(_ a: String, _ b: String, terms: [String]) -> String {
        let list = terms.count <= 1 ? (terms.first ?? "the same ideas") : terms.dropLast().joined(separator: ", ") + " and " + terms.last!
        return "\(a) and \(b) both cover \(list)."
    }
}

public extension Library {
    /// Connections over the theme lessons of non-sample projects (spec 10.8). Needs >= 2 such projects.
    func connections(limit: Int = 3) -> [Connection] {
        let real = Library.scopeProjects(projects)
        let rank = Dictionary(projects.enumerated().map { ($0.element.id, $0.offset) }, uniquingKeysWith: { a, _ in a })
        let ls = lessons.filter { !$0.isQuotes && real.contains($0.projectId) }
            .sorted { (rank[$0.projectId] ?? 0, $0.order) < (rank[$1.projectId] ?? 0, $1.order) }
        guard Set(ls.map(\.projectId)).count >= 2 else { return [] }
        let byLesson = Dictionary(grouping: cards, by: \.lessonId)
        let input = ls.map { ConnectionLesson(id: $0.id, projectId: $0.projectId, title: $0.title, statements: (byLesson[$0.id] ?? []).map(\.statement)) }
        return Connections.find(input, limit: limit)
    }
}

extension Library {
    /// Non-sample projects, plus the samples when there are fewer than 2 of those (spec 10.10).
    public static func scopeProjects(_ projects: [Project]) -> Set<String> {
        let real = projects.filter { $0.sample != true }
        return Set((real.count < 2 ? projects : real).map(\.id))
    }
}

public extension SessionBuilder {
    /// "Practice both": cards of two lessons interleaved (A, B, A, B), theme mix for level 1, 10 exercises.
    static func connection<R: RandomNumberGenerator>(_ a: [Card], _ b: [Card], profile: Profile, rng: inout R) -> [Exercise] {
        let a = a.filter { !$0.isPicture }, b = b.filter { !$0.isPicture }
        var mixed: [Card] = []
        for i in 0..<max(a.count, b.count) {
            if i < a.count { mixed.append(a[i]) }
            if i < b.count { mixed.append(b[i]) }
        }
        let sequence = Array((mixed + mixed).prefix(10))
        let all = a + b
        let extra = all.flatMap { longWords($0.statement) }
        let defs = all.filter(\.isDefinition)
        var out: [Exercise] = []
        for c in sequence {
            var kind = weightedPick(themeMix(level: 1), profile.practice, &rng)
            if kind == .match { kind = .mc }
            out.append(make(kind, card: c, extraWords: extra, defs: defs, rng: &rng))
        }
        return out
    }

    /// The class mix applies to class projects and to lessons that are mostly definition cards (spec 10.2).
    static func usesClassMix(projectIsClass: Bool, cards: [Card]) -> Bool {
        projectIsClass || (!cards.isEmpty && Double(cards.filter(\.isDefinition).count) >= 0.5 * Double(cards.count))
    }
}

import Foundation

// MARK: - TF-IDF

public struct SparseVector {
    public var weights: [String: Double]
    public var norm: Double { sqrt(weights.values.reduce(0) { $0 + $1 * $1 }) }
    public var sum: Double { weights.values.reduce(0, +) }

    public func normalized() -> SparseVector {
        let n = norm
        guard n > 0 else { return self }
        return SparseVector(weights: weights.mapValues { $0 / n })
    }

    public func cosine(_ o: SparseVector) -> Double {
        let (small, big) = weights.count < o.weights.count ? (weights, o.weights) : (o.weights, weights)
        var dot = 0.0
        for (k, v) in small { if let w = big[k] { dot += v * w } }
        let d = norm * o.norm
        return d > 0 ? dot / d : 0
    }

    public static func mean(_ vs: [SparseVector]) -> SparseVector {
        var acc: [String: Double] = [:]
        for v in vs { for (k, w) in v.weights { acc[k, default: 0] += w } }
        let n = Double(max(1, vs.count))
        return SparseVector(weights: acc.mapValues { $0 / n })
    }
}

public enum TFIDF {
    public static func vectors(_ docs: [[String]]) -> [SparseVector] {
        let n = Double(docs.count)
        var df: [String: Int] = [:]
        for d in docs { for t in Set(d) { df[t, default: 0] += 1 } }
        return docs.map { d in
            var tf: [String: Double] = [:]
            for t in d { tf[t, default: 0] += 1 }
            return SparseVector(weights: tf.reduce(into: [:]) { acc, kv in
                let idf = log((1 + n) / (1 + Double(df[kv.key] ?? 0))) + 1
                acc[kv.key] = kv.value * idf
            })
        }
    }
}

// MARK: - Grouping (spec 3.3)

public struct SuggestedGroup: Identifiable, Equatable {
    public var id: String
    public var title: String
    public var author: String?
    public var pageIds: [String]
    public var type: String
    public var category: String?      // v3 (spec 9.4)
    public init(id: String = IDGen.make(), title: String, author: String? = nil, pageIds: [String], type: String = "book", category: String? = nil) {
        self.id = id; self.title = title; self.author = author; self.pageIds = pageIds; self.type = type; self.category = category
    }
}

public enum Grouper {
    public static let unsorted = "Unsorted"

    static func headerKey(_ h: String) -> String {
        let lowered = h.lowercased().unicodeScalars.filter { CharacterSet.letters.contains($0) || $0 == " " }
        return TextKit.collapseWhitespace(String(String.UnicodeScalarView(lowered)))
    }

    /// Screenshots and notes: suggestedTitle, then header, then text similarity (spec 3.3).
    static func groupLoose(_ pages: [Page]) -> [SuggestedGroup] {
        var groups: [(key: String, title: String, author: String?, ids: [String])] = []
        func add(_ key: String, title: String, author: String?, id: String) {
            if let i = groups.firstIndex(where: { $0.key == key }) {
                groups[i].ids.append(id)
                if groups[i].author == nil { groups[i].author = author }
            } else {
                groups.append((key, title, author, [id]))
            }
        }
        var leftovers: [Page] = []
        var headerBuckets: [String: [Page]] = [:]
        var headerOrder: [String] = []
        for p in pages {
            if let t = p.suggestedTitle?.trimmingCharacters(in: .whitespaces), !t.isEmpty {
                add("t:" + TextKit.normalizeKey(t), title: t, author: p.suggestedAuthor, id: p.id)
            } else if let h = p.header, !headerKey(h).isEmpty {
                let k = headerKey(h)
                if headerBuckets[k] == nil { headerOrder.append(k) }
                headerBuckets[k, default: []].append(p)
            } else {
                leftovers.append(p)
            }
        }
        for k in headerOrder {
            let ps = headerBuckets[k]!
            if ps.count >= 2 {
                // Display the most common original spelling of the header.
                let counts = Dictionary(grouping: ps.compactMap(\.header), by: { $0 }).mapValues(\.count)
                let title = counts.max { $0.value < $1.value || ($0.value == $1.value && $0.key > $1.key) }?.key ?? k
                for p in ps { add("h:" + k, title: TextKit.titleCase(title), author: nil, id: p.id) }
            } else {
                leftovers.append(contentsOf: ps)
            }
        }
        // Rare headers and header-less pages join the closest group by TF-IDF centroid (cosine > 0.12).
        if !leftovers.isEmpty {
            let all = pages
            let vecs = TFIDF.vectors(all.map { TextKit.tokens(($0.header ?? "") + " " + $0.text) })
            let byId = Dictionary(uniqueKeysWithValues: zip(all.map(\.id), vecs))
            let centroids = groups.map { g in SparseVector.mean(g.ids.compactMap { byId[$0]?.normalized() }) }
            var unsorted: [String] = []
            for p in leftovers {
                guard let v = byId[p.id] else { unsorted.append(p.id); continue }
                var best = -1, bestScore = 0.12
                for (i, c) in centroids.enumerated() {
                    let s = v.cosine(c)
                    if s > bestScore { bestScore = s; best = i }
                }
                if best >= 0 { groups[best].ids.append(p.id) } else { unsorted.append(p.id) }
            }
            if !unsorted.isEmpty { groups.append(("u", Grouper.unsorted, nil, unsorted)) }
        }
        return groups.map { SuggestedGroup(title: $0.title, author: $0.author, pageIds: $0.ids) }
    }
}

// MARK: - Offline lesson builder (spec 4)

public struct BuiltCard: Equatable {
    public var pageId: String?
    public var statement: String
    public var cloze: String
    public var question: String
    public var answer: String
    public var distractors: [String]
    public var falseStatement: String
    public var term: String? = nil
    public var definition: String? = nil
}

public struct BuiltLesson: Equatable {
    public var title: String
    public var summary: String
    public var cards: [BuiltCard]
    /// Picture cards (spec 11.2) that join this lesson.
    public var pictures: [BuiltPicture] = []
}

/// A photo or diagram page recalled from its image (spec 11.2).
public struct BuiltPicture: Equatable {
    public var pageId: String
    public var statement: String
    public var question: String
}

public struct BuiltQuote: Equatable, Hashable {
    public var pageId: String?
    public var text: String
    public var attribution: String?
}

public struct BuildResult: Equatable {
    public var lessons: [BuiltLesson]
    public var quotes: [BuiltQuote]
}

/// Ordered term vector (insertion order like a JS Map) so floating point sums and tie breaks
/// match the web reference implementation exactly (web/src/engine/builder.ts).
public struct OVec {
    public var keys: [String] = []
    public var map: [String: Double] = [:]
    public subscript(_ k: String) -> Double? { map[k] }
    mutating func add(_ k: String, _ x: Double) {
        if let v = map[k] { map[k] = v + x } else { keys.append(k); map[k] = x }
    }
    var norm: Double { var s = 0.0; for k in keys { let x = map[k]!; s += x * x }; return s.squareRoot() }
    var sum: Double { var s = 0.0; for k in keys { s += map[k]! }; return s }
    func cosine(_ b: OVec) -> Double {
        let na = norm, nb = b.norm
        if na == 0 || nb == 0 { return 0 }
        let (small, big) = keys.count < b.keys.count ? (self, b) : (b, self)
        var dot = 0.0
        for k in small.keys { if let y = big.map[k], y != 0 { dot += small.map[k]! * y } }
        return dot / (na * nb)
    }
    static func centroid(_ vs: [OVec]) -> OVec {
        var c = OVec()
        for v in vs { for k in v.keys { c.add(k, v.map[k]!) } }
        if !vs.isEmpty { for k in c.keys { c.map[k] = c.map[k]! / Double(vs.count) } }
        return c
    }
}

/// Text primitives mirroring web/src/engine/text.ts.
public enum WebText {
    public static let stopwords: Set<String> = Set((
        "a about above after again against all am an and any are aren't as at be because been before being below " +
        "between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each " +
        "few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself " +
        "him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't " +
        "my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd " +
        "she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's " +
        "these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll " +
        "we're we've were weren't what what's when when's where where's which while who who's whom why why's will with " +
        "won't would wouldn't you you'd you'll you're you've your yours yourself yourselves also just like get got make " +
        "made many much may might must one ones us yet ever every even still upon shall"
    ).split(separator: " ").map(String.init))

    static let abbreviations: Set<String> = ["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "no", "vol", "ch", "fig", "inc", "ltd", "co", "mt"]
    static let wordRe = try! NSRegularExpression(pattern: "[a-z0-9]+(?:['\u{2019}][a-z]+)*")
    static let sentRe = try! NSRegularExpression(pattern: "[.?!]+[\"'\u{201D}\u{2019})]*(?=\\s+[\"'\u{201C}\u{2018}(]?[A-Z])")

    /// Lowercase words, letters/digits/apostrophes (ASCII, like the web regex).
    public static func words(_ text: String) -> [String] {
        let lower = text.lowercased() as NSString
        return wordRe.matches(in: lower as String, range: NSRange(location: 0, length: lower.length))
            .map { lower.substring(with: $0.range).replacingOccurrences(of: "\u{2019}", with: "'") }
    }

    public static func stem(_ w: String) -> String {
        for suf in ["ing", "es", "ed", "s"] where w.hasSuffix(suf) && w.count - suf.count >= 4 { return String(w.dropLast(suf.count)) }
        return w
    }

    public static func tokens(_ text: String) -> [(stem: String, surface: String)] {
        words(text).compactMap { raw in
            let w = raw.hasSuffix("'s") ? String(raw.dropLast(2)) : raw
            if w.count < 3 || stopwords.contains(raw) || stopwords.contains(w) || w.allSatisfy(\.isNumber) { return nil }
            return (stem(w), w)
        }
    }

    public static func splitSentences(_ text: String) -> [String] {
        let clean = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") as NSString
        guard clean.length > 0 else { return [] }
        var out: [String] = []
        var start = 0
        for m in sentRe.matches(in: clean as String, range: NSRange(location: 0, length: clean.length)) {
            let end = m.range.location + m.range.length
            guard m.range.location >= start else { continue }
            let before = clean.substring(with: NSRange(location: start, length: m.range.location - start))
            var last = (before.split(separator: " ").last.map(String.init) ?? "").lowercased()
            if let f = last.first, "\"'(\u{201C}".contains(f) { last.removeFirst() }
            let isPeriod = clean.substring(with: NSRange(location: m.range.location, length: 1)) == "."
            if isPeriod && (abbreviations.contains(last) || (last.count == 1 && last.first!.isLetter && last.first!.isASCII)) { continue }
            out.append(clean.substring(with: NSRange(location: start, length: end - start)).trimmingCharacters(in: .whitespaces))
            start = end
        }
        let tail = clean.substring(from: start).trimmingCharacters(in: .whitespaces)
        if !tail.isEmpty { out.append(tail) }
        return out.filter { !$0.isEmpty }
    }

    public static func titleCase(_ s: String) -> String {
        let small: Set<String> = ["a", "an", "and", "the", "of", "in", "on", "to", "for", "or", "at", "by", "with"]
        return s.lowercased().split(whereSeparator: { $0.isWhitespace }).enumerated().map { i, w in
            i > 0 && small.contains(String(w)) ? String(w) : w.prefix(1).uppercased() + w.dropFirst()
        }.joined(separator: " ")
    }

    static func normHeader(_ h: String?) -> String {
        let scalars = (h ?? "").lowercased().unicodeScalars.map { s -> Character in
            CharacterSet.decimalDigits.contains(s) || CharacterSet.punctuationCharacters.contains(s) || CharacterSet.symbols.contains(s) ? " " : Character(s)
        }
        return String(scalars).split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    static func tfidf(_ docs: [[String]]) -> [OVec] {
        var df: [String: Int] = [:]
        for d in docs { var seen = Set<String>(); for t in d where seen.insert(t).inserted { df[t, default: 0] += 1 } }
        let n = Double(docs.count)
        return docs.map { d in
            var tf = OVec()
            for t in d { tf.add(t, 1) }
            var v = OVec()
            for k in tf.keys {
                let idf = log((1 + n) / (1 + Double(df[k]!))) + 1
                v.add(k, (tf.map[k]! / Double(max(1, d.count))) * idf)
            }
            return v
        }
    }
}

public enum LessonBuilder {
    struct Sent {
        var text: String
        var pageId: String
        var header: String?
        var toks: [(stem: String, surface: String)]
        var vec = OVec()
        var order: Int
    }

    static let imperatives: Set<String> = ["be", "do", "don't", "dont", "never", "always", "remember", "give", "make", "let", "try",
        "talk", "ask", "begin", "avoid", "show", "become", "smile", "listen", "think", "keep", "treat", "choose", "act"]
    static let aphorismMarkers = ["the only way", "is the", "most people", "you can"]

    /// Generic words that make weak lesson titles (spec 4.5). Demoted, never banned.
    public static let weakTitleWords: Set<String> = [
        "short", "long", "great", "good", "many", "much", "make", "take", "life", "time", "thing", "things", "way",
        "people", "person", "learn", "know", "every", "first", "little", "own", "whole", "day", "new", "old", "big",
        "small", "come", "give", "find", "need", "want", "work", "year", "years", "man", "men", "part", "place", "right",
        "live", "living", "lived", "nothing", "something", "anything", "everything", "hard", "harder", "easy", "best",
        "better", "less", "high", "highest", "same", "other", "able", "use", "used", "say", "see", "keep", "put", "get",
        "seem", "look", "tell", "call", "mean", "become", "went", "came", "wish", "wished", "one", "two", "three", "lot", "lots",
        "kind", "sort", "bit", "given", "gave", "made", "taken", "done", "said",
    ]

    static func isWeak(_ w: String) -> Bool {
        let l = w.lowercased()
        return weakTitleWords.contains(l) || weakTitleWords.contains(WebText.stem(l))
    }

    /// Lesson title for a theme cluster (spec 4.5): repeated adjacent phrase, else "A & B" with weak words demoted.
    static func themeTitle(_ sentences: [String], _ centroid: OVec, _ surfaces: [String: String], _ used: Set<String>) -> String {
        struct P { var n: Int; var first: Int; var a: String; var b: String }
        var pairs: [String: P] = [:]
        var pairOrder: [String] = []
        var pos = 0
        for sent in sentences {
            let ws = WebText.words(sent).map { $0.hasSuffix("'s") ? String($0.dropLast(2)) : $0 }
            var seen = Set<String>()
            var i = 0
            while i + 1 < ws.count {
                let a = ws[i], b = ws[i + 1]
                defer { i += 1 }
                if a.count < 3 || b.count < 3 || WebText.stopwords.contains(a) || WebText.stopwords.contains(b) || (a + b).contains(where: \.isNumber) { continue }
                if isWeak(a) && isWeak(b) { continue }
                let key = "\(a) \(b)"
                var e = pairs[key] ?? P(n: 0, first: pos + i, a: a, b: b)
                if pairs[key] == nil { pairOrder.append(key) }
                if seen.insert(key).inserted { e.n += 1 }
                pairs[key] = e
            }
            pos += ws.count
        }
        func weight(_ w: String) -> Double { centroid[WebText.stem(w)] ?? 0 }
        let phrases = pairOrder.compactMap { k -> (String, P)? in let p = pairs[k]!; return p.n >= 2 ? (k, p) : nil }
            .sorted { x, y in
                if x.1.n != y.1.n { return x.1.n > y.1.n }
                let wx = weight(x.1.a) + weight(x.1.b), wy = weight(y.1.a) + weight(y.1.b)
                if wx != wy { return wx > wy }
                return x.1.first < y.1.first
            }
        for (key, _) in phrases {
            let t = WebText.titleCase(key)
            if !used.contains(t) { return t }
        }
        let terms = centroid.keys.map { st -> (word: String, score: Double) in
            let w = surfaces[st] ?? st
            return (w, centroid.map[st]! * (isWeak(w) ? 0.35 : 1))
        }
        .sorted { $0.score != $1.score ? $0.score > $1.score : $0.word < $1.word }
        .map(\.word)
        var pick: [String] = []
        for t in terms {
            if pick.count == 2 { break }
            let sameRoot = pick.count == 1 && pick[0].prefix(4).lowercased() == t.prefix(4).lowercased()
            if !pick.contains(t) && !sameRoot { pick.append(t) }
            if pick.count == 2 && used.contains(WebText.titleCase(pick.joined(separator: " & "))) { pick.removeLast() }
        }
        let title = WebText.titleCase(pick.joined(separator: " & "))
        return title.isEmpty ? "Key Ideas" : title
    }

    static func shapeClass(_ w: String) -> String {
        let x = w.lowercased()
        func m(_ p: String) -> Bool { x.range(of: p, options: .regularExpression) != nil }
        if m("ly$") { return "ly" }
        if m("ing$") { return "ing" }
        if m("ed$") { return "ed" }
        if m("(tion|sion|ment|ness|ity|ance|ence|ship)s?$") { return "noun" }
        if m("(ous|ful|ive|able|ible|ical|less|ent|ant)$") { return "adj" }
        if m("[^s]s$") { return "s" }
        return "other"
    }

    static func exactSurface(_ sentence: String, _ lower: String) -> String? {
        let pattern = "(?<![\\p{L}\\p{N}])(" + NSRegularExpression.escapedPattern(for: lower) + ")(?![\\p{L}\\p{N}])"
        guard let r = sentence.range(of: pattern, options: [.regularExpression, .caseInsensitive]) else { return nil }
        return String(sentence[r])
    }

    static func containsTerm(_ text: String, _ term: String) -> Bool {
        text.range(of: "(^|[^\\p{L}\\p{N}])" + NSRegularExpression.escapedPattern(for: term) + "(?![\\p{L}\\p{N}])", options: [.regularExpression, .caseInsensitive]) != nil
    }

    public static func build(pages: [Page], title projectTitle: String? = nil, author: String? = nil) -> BuildResult {
        // 1. Sentences.
        var sents: [Sent] = []
        var seen = Set<String>()
        var order = 0
        for p in pages {
            for s in WebText.splitSentences(p.text) {
                let n = TextKit.wordCount(s)
                guard (7...45).contains(n) else { continue }
                let key = WebText.words(s).joined(separator: " ")
                guard seen.insert(key).inserted else { continue }
                sents.append(Sent(text: s, pageId: p.id, header: p.header, toks: WebText.tokens(s), order: order))
                order += 1
            }
        }
        let quotes = quoteCandidates(pages: pages, author: author)
        guard !sents.isEmpty else { return BuildResult(lessons: [], quotes: quotes) }

        // 2-3. TF-IDF.
        let vecs = WebText.tfidf(sents.map { $0.toks.map(\.stem) })
        for i in sents.indices { sents[i].vec = vecs[i] }
        var counts: [String: [(String, Int)]] = [:]
        var stemOrder: [String] = []
        for s in sents { for t in s.toks {
            if counts[t.stem] == nil { stemOrder.append(t.stem); counts[t.stem] = [] }
            if let i = counts[t.stem]!.firstIndex(where: { $0.0 == t.surface }) { counts[t.stem]![i].1 += 1 } else { counts[t.stem]!.append((t.surface, 1)) }
        } }
        var surfaces: [String: String] = [:]
        for st in stemOrder {
            var best = "", bc = -1
            for (sf, c) in counts[st]! where c > bc || (c == bc && sf.count < best.count) { best = sf; bc = c }
            surfaces[st] = best
        }

        // 4. Themes. Headers equal to the book title are not chapters.
        let titleKey = WebText.normHeader(projectTitle)
        var headerCounts: [String: (raw: String, n: Int)] = [:]
        var headerOrder: [String] = []
        for s in sents {
            let h = WebText.normHeader(s.header)
            if h.isEmpty || h == titleKey { continue }
            if headerCounts[h] == nil { headerOrder.append(h); headerCounts[h] = (s.header!.trimmingCharacters(in: .whitespaces), 0) }
            headerCounts[h]!.n += 1
        }
        let chapters = headerOrder.filter { headerCounts[$0]!.n >= 3 }
        var groups: [(title: String?, sents: [Sent])] = []
        if chapters.count >= 2 {
            var by: [String: [Sent]] = Dictionary(uniqueKeysWithValues: chapters.map { ($0, []) })
            var orphans: [Sent] = []
            for s in sents { let h = WebText.normHeader(s.header); if by[h] != nil { by[h]!.append(s) } else { orphans.append(s) } }
            let cents = chapters.map { OVec.centroid(by[$0]!.map(\.vec)) }
            for s in orphans {
                var bi = 0, bv = -1.0
                for (ci, c) in cents.enumerated() { let v = s.vec.cosine(c); if v > bv { bv = v; bi = ci } }
                by[chapters[bi]]!.append(s)
            }
            groups = chapters.map { (WebText.titleCase(headerCounts[$0]!.raw), by[$0]!) }
        } else {
            let k = min(6, max(1, Int((Double(sents.count) / 5).squareRoot().rounded(.toNearestOrAwayFromZero))))
            let assign = kmeans(sents, k)
            var raw = [[Sent]](repeating: [], count: k)
            for (i, s) in sents.enumerated() { raw[assign[i]].append(s) }
            groups = absorbSmall(raw).map { (nil, $0) }
        }
        for i in groups.indices { groups[i].sents.sort { $0.order < $1.order } }
        groups.sort { $0.sents[0].order < $1.sents[0].order }

        // Project-wide term weights for distractor fallback.
        var projectWeights = OVec()
        for s in sents { for k in s.vec.keys { projectWeights.add(k, s.vec.map[k]!) } }
        let topProjectTerms = projectWeights.keys.enumerated()
            .sorted { projectWeights.map[$0.element]! != projectWeights.map[$1.element]! ? projectWeights.map[$0.element]! > projectWeights.map[$1.element]! : $0.offset < $1.offset }
            .map { surfaces[$0.element] ?? $0.element }
            .filter { $0.count >= 4 }

        // 5-6. Titles, summaries, cards.
        var used = Set<String>()
        var pre: [(title: String, summary: String, picks: [(s: Sent, cloze: String)])] = []
        for g in groups {
            let c = OVec.centroid(g.sents.map(\.vec))
            let base = g.title ?? themeTitle(g.sents.map(\.text), c, surfaces, used)
            var t = base
            var n = 2
            while used.contains(t) { t = "\(base) \(n)"; n += 1 }
            used.insert(t)
            var best = g.sents[0], bv = -1.0
            for s in g.sents { let v = s.vec.cosine(c); if v > bv { bv = v; best = s } }
            let ranked = g.sents.sorted { $0.vec.sum != $1.vec.sum ? $0.vec.sum > $1.vec.sum : $0.order < $1.order }
            var picks: [(s: Sent, cloze: String)] = []
            for s in ranked {
                if picks.count >= 14 { break }
                let lowerText = s.text.lowercased()
                let cands = s.toks.enumerated().filter { $0.element.surface.count >= 4 }
                    .map { (tk: $0.element, w: (s.vec[$0.element.stem] ?? 0) * ($0.offset == 0 && lowerText.hasPrefix($0.element.surface) ? 0.6 : 1), i: $0.offset) }
                    .sorted { $0.w != $1.w ? $0.w > $1.w : $0.i < $1.i }
                var cloze: String?
                for cnd in cands { if let e = exactSurface(s.text, cnd.tk.surface) { cloze = e; break } }
                if let cloze { picks.append((s, cloze)) }
            }
            picks.sort { $0.s.order < $1.s.order }
            pre.append((t, TextKit.truncate(best.text, 120), picks))
        }

        var allClozes: [String] = []
        for l in pre { for p in l.picks where !allClozes.contains(p.cloze.lowercased()) { allClozes.append(p.cloze.lowercased()) } }
        let lessons: [BuiltLesson] = pre.map { l in
            BuiltLesson(title: l.title, summary: l.summary, cards: l.picks.map { pk in
                let lower = pk.cloze.lowercased()
                let shape = shapeClass(lower)
                let fromCards = allClozes.filter { $0 != lower && !containsTerm(pk.s.text, $0) }.sorted { a, b in
                    let sa = shapeClass(a) == shape, sb = shapeClass(b) == shape
                    if sa != sb { return sa }
                    let da = abs(a.count - lower.count), db = abs(b.count - lower.count)
                    if da != db { return da < db }
                    return a < b
                }
                var distractors = Array(fromCards.prefix(3))
                for t in topProjectTerms where distractors.count < 3 {
                    let tl = t.lowercased()
                    if tl != lower && !distractors.contains(tl) && !containsTerm(pk.s.text, tl) { distractors.append(tl) }
                }
                let stripped = pk.s.text.drop(while: { "\"\u{201C}'(".contains($0) })
                let answer = stripped.hasPrefix(pk.cloze) ? lower : pk.cloze
                return BuiltCard(pageId: pk.s.pageId, statement: pk.s.text, cloze: pk.cloze,
                                 question: replaceFirst(in: pk.s.text, pk.cloze, with: "____"), answer: answer, distractors: distractors,
                                 falseStatement: distractors.first.map { replaceFirst(in: pk.s.text, pk.cloze, with: matchCase($0, like: pk.cloze)) } ?? pk.s.text)
            })
        }
        return BuildResult(lessons: lessons.filter { !$0.cards.isEmpty }, quotes: quotes)
    }

    static func kmeans(_ sents: [Sent], _ k: Int) -> [Int] {
        let n = sents.count
        if k <= 1 || n <= k { return [Int](repeating: 0, count: n) }
        var first = 0
        for i in 1..<n where sents[i].vec.norm > sents[first].vec.norm { first = i }
        var seeds = [first]
        while seeds.count < k {
            var best = -1, bestD = -1.0
            for i in 0..<n where !seeds.contains(i) {
                let d = seeds.map { 1 - sents[i].vec.cosine(sents[$0].vec) }.min()!
                if d > bestD { bestD = d; best = i }
            }
            if best < 0 { break }
            seeds.append(best)
        }
        var cents = seeds.map { sents[$0].vec }
        var assign = [Int](repeating: 0, count: n)
        for _ in 0..<12 {
            assign = sents.map { s in
                var bi = 0, bv = -1.0
                for (ci, c) in cents.enumerated() { let v = s.vec.cosine(c); if v > bv { bv = v; bi = ci } }
                return bi
            }
            cents = cents.enumerated().map { ci, c in
                let members = sents.indices.filter { assign[$0] == ci }.map { sents[$0].vec }
                return members.isEmpty ? c : OVec.centroid(members)
            }
        }
        return assign
    }

    static func absorbSmall(_ groups: [[Sent]]) -> [[Sent]] {
        var gs = groups.filter { !$0.isEmpty }
        while gs.count > 1, let si = gs.firstIndex(where: { $0.count < 3 }) {
            let small = gs[si]
            var rest = gs; rest.remove(at: si)
            let cents = rest.map { OVec.centroid($0.map(\.vec)) }
            for s in small {
                var bi = 0, bv = -1.0
                for (ci, c) in cents.enumerated() { let v = s.vec.cosine(c); if v > bv { bv = v; bi = ci } }
                rest[bi].append(s)
            }
            gs = rest
        }
        return gs
    }
    static func replaceFirst(in s: String, _ word: String, with rep: String) -> String {
        let pattern = "\\b" + NSRegularExpression.escapedPattern(for: word) + "\\b"
        if let r = s.range(of: pattern, options: [.regularExpression, .caseInsensitive]) {
            return s.replacingCharacters(in: r, with: rep)
        }
        if let r = s.range(of: word, options: .caseInsensitive) { return s.replacingCharacters(in: r, with: rep) }
        return s
    }

    static func matchCase(_ w: String, like ref: String) -> String {
        guard let f = ref.first else { return w }
        if f.isUppercase { return w.prefix(1).uppercased() + w.dropFirst() }
        return w.lowercased() == w ? w : (w.prefix(1).lowercased() + w.dropFirst())
    }

    // 7. Quote candidates.
    public static func quoteCandidates(pages: [Page], author: String?) -> [BuiltQuote] {
        var out: [BuiltQuote] = []
        var seen = Set<String>()
        func add(_ text: String, _ page: Page) {
            let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = TextKit.normalizeKey(t)
            guard !key.isEmpty, !seen.contains(key), out.count < 20 else { return }
            seen.insert(key)
            out.append(BuiltQuote(pageId: page.id, text: t, attribution: author ?? page.suggestedAuthor))
        }
        let quoteRegex = try! NSRegularExpression(pattern: "[\u{201C}\"]([^\u{201C}\u{201D}\"]{10,400})[\u{201D}\"]")
        for p in pages {
            if p.verbatim == true || (p.verbatim == nil && p.kind == "note" && p.suggestedAuthor != nil), TextKit.wordCount(p.text) <= 60, TextKit.wordCount(p.text) >= 4 {
                add(p.text, p)
                continue
            }
            let ns = p.text as NSString
            for m in quoteRegex.matches(in: p.text, range: NSRange(location: 0, length: ns.length)) {
                let inner = ns.substring(with: m.range(at: 1))
                if (6...50).contains(TextKit.wordCount(inner)) { add(inner, p) }
            }
            for s in TextKit.sentences(p.text) {
                let wc = TextKit.wordCount(s)
                guard (6...30).contains(wc) else { continue }
                let first = TextKit.rawWords(s).first ?? ""
                let lower = s.lowercased()
                if imperatives.contains(first) || aphorismMarkers.contains(where: { lower.contains($0) }) { add(s, p) }
            }
        }
        return out
    }
}

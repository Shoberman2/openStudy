import Foundation

// MARK: - Offline concept questions (spec 13.3)

/// Turns sentences like "X because Y", "The key to X is Y" or "If X, Y" into short questions about the
/// idea instead of a missing word. Deterministic, mirrors web/src/engine/concepts.ts.
public enum Concepts {
    public struct Match: Equatable { public var question: String; public var answer: String }

    static func re(_ p: String, ci: Bool = true) -> NSRegularExpression { try! NSRegularExpression(pattern: p, options: ci ? [.caseInsensitive] : []) }
    static let why = re("^(.+?),? (because|so that|in order to) (.+)$")
    static let insteadFirst = re("^Instead of ([^,]+), (.+)$")
    static let instead = re("^(.+?) instead of (.+)$")
    static let ifWhen = re("^(If|When|Whenever) ([^,]+), (.+)$")
    static let theIs = re("^(The [^,]+?) (is|are) (.+)$", ci: false)
    static let effect = re("^(.+?) (leads to|lead to|causes|cause|results in|result in|prevents|prevent|reduces|reduce|increases|increase|improves|improve|depends on|depend on|protects|protect|controls|control) (.+)$")
    static let define = re("^(\\p{Lu}[\\p{L}'-]*(?: [\\p{L}'-]+){0,2}) (is|are) (.+)$", ci: false)
    static let pronouns: Set<String> = ["it", "this", "that", "these", "those", "they", "he", "she", "which", "who", "what"]
    static let theIsStarts: Set<String> = ["a", "an", "the", "to", "one", "that", "what", "how", "when", "where", "why", "your", "our", "their", "his", "her", "its", "my"]
    static let defineStarts: Set<String> = ["a", "an", "the", "one", "nothing", "your", "our", "their"]

    static func upperFirst(_ s: String) -> String { s.prefix(1).uppercased() + String(s.dropFirst()) }
    static func firstWord(_ s: String) -> String { (TextKit.words(s).first ?? "").lowercased() }
    static func within(_ s: String, _ lo: Int, _ hi: Int) -> Bool { (lo...hi).contains(TextKit.wordCount(s)) }
    static func startsWithPronoun(_ a: String) -> Bool { pronouns.contains(firstWord(a)) }

    /// An answer ends at the first semicolon or ", and" / ", but" / ", which", and drops trailing commas.
    static func answerPart(_ s: String) -> String {
        var t = s
        if let r = t.range(of: ";|, (?:and|but|which) ", options: .regularExpression) { t = String(t[..<r.lowerBound]) }
        t = t.trimmingCharacters(in: .whitespacesAndNewlines)
        while t.hasSuffix(",") { t.removeLast() }
        return t
    }

    /// Lowercases the first letter unless the first word's letters are all capitals (2+ letters) or it has a capital after its first letter.
    public static func lowerFirst(_ s: String) -> String {
        let letters = String((TextKit.words(s).first ?? "").filter(\.isLetter))
        if letters.count >= 2 && letters == letters.uppercased() { return s }
        if letters.dropFirst().contains(where: \.isUppercase) { return s }
        return s.prefix(1).lowercased() + String(s.dropFirst())
    }

    static func groups(_ re: NSRegularExpression, _ s: String) -> [String]? {
        let ns = s as NSString
        guard let m = re.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return (0..<m.numberOfRanges).map { m.range(at: $0).location == NSNotFound ? "" : ns.substring(with: m.range(at: $0)) }
    }

    static func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Tried in this order; the first rule whose checks all pass wins (spec 13.3).
    static let rules: [(String) -> Match?] = [
        // 1. Why
        { s in
            guard let g = groups(why, s) else { return nil }
            let a = trimmed(g[1]), b = answerPart(g[3])
            guard !startsWithPronoun(a), !a.contains(":"), within(a, 3, 16), within(b, 2, 14) else { return nil }
            return Match(question: "\(a). Why?", answer: upperFirst(b))
        },
        // 2. Instead (first)
        { s in
            guard let g = groups(insteadFirst, s) else { return nil }
            let x = trimmed(g[1]), b = answerPart(g[2])
            guard within(x, 1, 8), within(b, 2, 10) else { return nil }
            return Match(question: "What should you do instead of \(x)?", answer: upperFirst(b))
        },
        // 3. Instead
        { s in
            guard let g = groups(instead, s) else { return nil }
            let b = answerPart(g[1]), x = trimmed(g[2])
            guard !startsWithPronoun(b), !["the", "a", "an"].contains(firstWord(b)), within(x, 1, 8), within(b, 2, 10) else { return nil }
            return Match(question: "What should you do instead of \(x)?", answer: upperFirst(b))
        },
        // 4. If / when
        { s in
            guard let g = groups(ifWhen, s) else { return nil }
            let c = trimmed(g[2]), b = answerPart(g[3])
            guard within(c, 2, 12), within(b, 2, 12) else { return nil }
            return Match(question: "\(upperFirst(g[1].lowercased())) \(c), then what?", answer: upperFirst(b))
        },
        // 5. The X is
        { s in
            guard let g = groups(theIs, s) else { return nil }
            let a = trimmed(g[1]), b = answerPart(g[3])
            guard !a.contains(":"), within(a, 2, 10), within(b, 2, 12), theIsStarts.contains(firstWord(b)) else { return nil }
            return Match(question: "What \(g[2]) \(lowerFirst(a))?", answer: upperFirst(b))
        },
        // 6. Effect
        { s in
            guard let g = groups(effect, s) else { return nil }
            let a = trimmed(g[1]), b = answerPart(g[3])
            guard !startsWithPronoun(a), !a.contains(","), !a.contains(":"), within(a, 1, 8), within(b, 2, 12) else { return nil }
            let v = g[2].lowercased()
            var parts = v.split(separator: " ").map(String.init)
            let third = parts[0].hasSuffix("s")
            if third { parts[0] = String(parts[0].dropLast()) }
            let base = third ? parts.joined(separator: " ") : v
            return Match(question: "What \(third ? "does" : "do") \(lowerFirst(a)) \(base)?", answer: upperFirst(b))
        },
        // 7. Define
        { s in
            guard let g = groups(define, s) else { return nil }
            let a = trimmed(g[1]), b = answerPart(g[3])
            guard !TextKit.stopwords.contains(firstWord(a)), within(b, 2, 12), defineStarts.contains(firstWord(b)) else { return nil }
            return Match(question: "What \(g[2]) \(lowerFirst(a))?", answer: upperFirst(b))
        },
    ]

    /// The concept question for one statement, or nil when no rule fits.
    public static func question(_ statement: String) -> Match? {
        let s = trimmed(trimmed(statement).replacingOccurrences(of: "[.!?\"\u{201D}\u{2019}')\\],]+$", with: "", options: .regularExpression))
        for rule in rules { if let m = rule(s) { return m } }
        return nil
    }

    /// Rewrites matching fact cards as concept cards when the project has at least 4 matches, so each
    /// can get 3 wrong answers of the same kind. Definition cards are skipped.
    public static func apply(_ result: BuildResult) -> BuildResult {
        var found: [(li: Int, ci: Int, m: Match)] = []
        for (li, l) in result.lessons.enumerated() {
            for (ci, c) in l.cards.enumerated() where (c.term ?? "").isEmpty {
                if let m = question(c.statement) { found.append((li, ci, m)) }
            }
        }
        guard found.count >= 4 else { return result }
        var out = result
        for (i, f) in found.enumerated() {
            let card = result.lessons[f.li].cards[f.ci]
            let own = AnswerChecker.normalize(f.m.answer)
            let len = TextKit.wordCount(f.m.answer)
            let ranked = found.enumerated()
                .filter { j, o in j != i && AnswerChecker.normalize(o.m.answer) != own && !LessonBuilder.containsTerm(card.statement, o.m.answer) }
                .map { (j: $0.offset, a: $0.element.m.answer) }
                .sorted { x, y in
                    let dx = abs(TextKit.wordCount(x.a) - len), dy = abs(TextKit.wordCount(y.a) - len)
                    return dx != dy ? dx < dy : x.j < y.j
                }
            var distractors: [String] = []
            for o in ranked where distractors.count < 3 {
                let n = AnswerChecker.normalize(o.a)
                if !distractors.contains(where: { AnswerChecker.normalize($0) == n }) { distractors.append(o.a) }
            }
            guard distractors.count == 3 else { continue }
            out.lessons[f.li].cards[f.ci].question = f.m.question
            out.lessons[f.li].cards[f.ci].answer = f.m.answer
            out.lessons[f.li].cards[f.ci].concept = result.lessons[f.li].title
            out.lessons[f.li].cards[f.ci].distractors = distractors
        }
        return out
    }
}

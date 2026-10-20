import Foundation

/// Shared text helpers for the offline engine (spec section 4 steps 1 and 2).
public enum TextKit {
    public static let stopwords: Set<String> = [
        "a", "about", "above", "after", "again", "against", "all", "also", "am", "an", "and", "any", "are", "aren't", "as", "at",
        "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can", "can't", "cannot", "could",
        "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during", "each", "even", "ever", "every",
        "few", "for", "from", "further", "get", "gets", "got", "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he",
        "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "however",
        "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself", "just", "let's", "like",
        "made", "make", "many", "may", "me", "might", "more", "most", "much", "must", "mustn't", "my", "myself", "never", "no",
        "nor", "not", "now", "of", "off", "often", "on", "once", "one", "only", "or", "other", "others", "ought", "our", "ours",
        "ourselves", "out", "over", "own", "perhaps", "quite", "rather", "really", "said", "same", "say", "says", "see", "shall",
        "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "since", "so", "some", "still", "such", "than", "that",
        "that's", "the", "their", "theirs", "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll",
        "they're", "they've", "thing", "things", "this", "those", "though", "through", "thus", "to", "too", "under", "until",
        "up", "upon", "us", "very", "was", "wasn't", "way", "we", "we'd", "we'll", "we're", "we've", "well", "were", "weren't",
        "what", "what's", "when", "when's", "where", "where's", "whether", "which", "while", "who", "who's", "whom", "whose",
        "why", "why's", "will", "with", "within", "without", "won't", "would", "wouldn't", "yet", "you", "you'd", "you'll",
        "you're", "you've", "your", "yours", "yourself", "yourselves", "will", "shall", "upon", "lets", "dont", "cant", "wont",
        "im", "ive", "youre", "thats", "its", "isnt", "doesnt", "didnt", "theyre",
    ]

    static let abbreviations: Set<String> = [
        "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "eg", "ie", "no", "vol", "ch", "p", "pp",
        "fig", "inc", "ltd", "co", "mt", "gen", "col", "lt", "sgt", "capt", "rev", "hon", "u.s", "a.m", "p.m",
    ]

    static let closers: Set<Character> = ["\"", "'", "\u{201D}", "\u{2019}", ")", "]"]
    static let openers: Set<Character> = ["\"", "'", "\u{201C}", "\u{2018}", "(", "["]

    /// Split on `.?!` followed by whitespace and a capital letter (optionally after an opening quote),
    /// keeping common abbreviations such as "Mr." "Dr." "e.g." intact.
    public static func sentences(_ text: String) -> [String] {
        let chars = Array(text.replacingOccurrences(of: "\n", with: " "))
        var result: [String] = []
        var start = 0
        var i = 0
        while i < chars.count {
            let ch = chars[i]
            if ch == "." || ch == "?" || ch == "!" {
                var end = i + 1
                while end < chars.count, closers.contains(chars[end]) || chars[end] == "." || chars[end] == "!" || chars[end] == "?" { end += 1 }
                var j = end
                guard j < chars.count, chars[j].isWhitespace else { i += 1; continue }
                while j < chars.count, chars[j].isWhitespace { j += 1 }
                var k = j
                while k < chars.count, openers.contains(chars[k]) { k += 1 }
                guard k < chars.count, chars[k].isUppercase || chars[k].isNumber else { i += 1; continue }
                if ch == "." {
                    // Word before the period.
                    var w = i - 1
                    while w >= start, !chars[w].isWhitespace, !openers.contains(chars[w]) { w -= 1 }
                    let word = String(chars[(w + 1)..<i]).lowercased()
                    if abbreviations.contains(word) || (word.count == 1 && word.first!.isLetter) { i += 1; continue }
                }
                let s = String(chars[start..<end]).trimmingCharacters(in: .whitespaces)
                if !s.isEmpty { result.append(s) }
                start = j
                i = j
                continue
            }
            i += 1
        }
        if start < chars.count {
            let s = String(chars[start...]).trimmingCharacters(in: .whitespaces)
            if !s.isEmpty { result.append(s) }
        }
        return result
    }

    public static func words(_ text: String) -> [String] {
        text.split(whereSeparator: { $0.isWhitespace }).map(String.init)
    }

    public static func wordCount(_ text: String) -> Int { words(text).count }

    /// Lowercase, strip punctuation (keep letters, digits, apostrophes inside words), split.
    public static func rawWords(_ text: String) -> [String] {
        var out: [String] = []
        var cur = ""
        for ch in text.lowercased() {
            if ch.isLetter || ch.isNumber {
                cur.append(ch)
            } else if (ch == "'" || ch == "\u{2019}") && !cur.isEmpty {
                cur.append("'")
            } else {
                if !cur.isEmpty { out.append(cur.trimmingCharacters(in: CharacterSet(charactersIn: "'"))); cur = "" }
            }
        }
        if !cur.isEmpty { out.append(cur.trimmingCharacters(in: CharacterSet(charactersIn: "'"))) }
        return out.filter { !$0.isEmpty }
    }

    /// Light stemming: strip trailing ing, ed, es, s when the remainder is >= 4 chars.
    public static func stem(_ w: String) -> String {
        for suf in ["ing", "ed", "es", "s"] where w.hasSuffix(suf) {
            let rest = String(w.dropLast(suf.count))
            if rest.count >= 4 { return rest }
        }
        return w
    }

    public static func isStop(_ w: String) -> Bool {
        stopwords.contains(w) || stopwords.contains(w.replacingOccurrences(of: "'", with: ""))
    }

    /// Content tokens: lowercase words, no stopwords, >= 3 chars, stemmed.
    public static func tokens(_ text: String) -> [String] {
        rawWords(text).compactMap { w in
            let clean = w.replacingOccurrences(of: "'s", with: "")
            guard clean.count >= 3, !isStop(clean), !isStop(w), clean.contains(where: { $0.isLetter }) else { return nil }
            return stem(clean.replacingOccurrences(of: "'", with: ""))
        }
    }

    /// (surface, stem) pairs for content words, keeping original casing of the surface word.
    public static func surfaceTokens(_ text: String) -> [(surface: String, stem: String)] {
        words(text).compactMap { raw in
            let trimmed = raw.trimmingCharacters(in: CharacterSet.punctuationCharacters.union(.symbols))
            let lower = trimmed.lowercased().replacingOccurrences(of: "\u{2019}", with: "'")
            let clean = lower.hasSuffix("'s") ? String(lower.dropLast(2)) : lower
            guard clean.count >= 3, !isStop(clean), !isStop(lower), clean.allSatisfy({ $0.isLetter || $0 == "-" || $0 == "'" }) else { return nil }
            let surface = trimmed.hasSuffix("'s") || trimmed.hasSuffix("\u{2019}s") ? String(trimmed.dropLast(2)) : trimmed
            return (surface, stem(clean.replacingOccurrences(of: "'", with: "")))
        }
    }

    public static func normalizeKey(_ s: String) -> String {
        rawWords(s).joined(separator: " ")
    }

    public static func titleCase(_ s: String) -> String {
        let small: Set<String> = ["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"]
        let ws = words(s.lowercased())
        return ws.enumerated().map { i, w in
            if i > 0 && small.contains(w) { return w }
            return w.prefix(1).uppercased() + w.dropFirst()
        }.joined(separator: " ")
    }

    public static func truncate(_ s: String, _ n: Int) -> String {
        guard s.count > n else { return s }
        let cut = s.prefix(n - 1)
        if let sp = cut.lastIndex(of: " "), cut.distance(from: cut.startIndex, to: sp) > n / 2 {
            return String(cut[..<sp]).trimmingCharacters(in: .punctuationCharacters) + "\u{2026}"
        }
        return String(cut) + "\u{2026}"
    }

    public static func collapseWhitespace(_ s: String) -> String {
        s.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    public static func stripHTML(_ s: String) -> String {
        var t = s.replacingOccurrences(of: "<br\\s*/?>", with: "\n", options: [.regularExpression, .caseInsensitive])
        t = t.replacingOccurrences(of: "</(p|div|li|h[1-6])>", with: "\n\n", options: [.regularExpression, .caseInsensitive])
        t = t.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        let entities = ["&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&rsquo;": "\u{2019}", "&lsquo;": "\u{2018}", "&ldquo;": "\u{201C}", "&rdquo;": "\u{201D}"]
        for (k, v) in entities { t = t.replacingOccurrences(of: k, with: v) }
        return t
    }
}

/// Deterministic RNG so sessions and tests are reproducible when seeded.
public struct SeededRNG: RandomNumberGenerator {
    private var state: UInt64
    public init(seed: UInt64) { state = seed == 0 ? 0x9E3779B97F4A7C15 : seed }
    public mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}

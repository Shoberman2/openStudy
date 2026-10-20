import Foundation

// MARK: - Subject categories (spec 9.4). The lexicon is a copy of shared/categories.json.

public enum Categories {
    struct Lexicon: Decodable {
        struct Category: Decodable { var name: String; var words: [String] }
        var genericFolders: [String]
        var coursePrefixes: [String: String]
        var categories: [Category]
    }

    struct Loaded {
        var generic: Set<String>
        var prefixes: [String: String]
        var categories: [(name: String, stems: Set<String>)]
    }

    public static let fallback: [String: String] = ["book": "Reading", "class": "Classes", "other": "General"]

    private static var loaded: Loaded = load(bundled())

    /// Replaces the lexicon (tests and tools that run outside the app bundle).
    public static func use(_ data: Data) { loaded = load(data) }

    static func bundled() -> Data? {
        for b in [Bundle.main] + Bundle.allBundles {
            if let url = b.url(forResource: "categories", withExtension: "json"), let d = try? Data(contentsOf: url) { return d }
        }
        return nil
    }

    static func load(_ data: Data?) -> Loaded {
        guard let data, let lex = try? JSONDecoder().decode(Lexicon.self, from: data) else { return Loaded(generic: [], prefixes: [:], categories: []) }
        return Loaded(generic: Set(lex.genericFolders.map { $0.lowercased() }), prefixes: lex.coursePrefixes,
                      categories: lex.categories.map { c in (c.name, Set(c.words.flatMap(WebText.words).map(WebText.stem))) })
    }

    public static var names: [String] { loaded.categories.map(\.name) }

    public static func isGenericFolder(_ f: String?) -> Bool {
        let k = (f ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return k.isEmpty || loaded.generic.contains(k)
    }

    /// The non-generic folder shared by >= 60% of the pages, if any (first seen wins ties).
    public static func sharedFolder(_ folders: [String?]) -> String? {
        guard !folders.isEmpty else { return nil }
        var order: [String] = []
        var counts: [String: (name: String, n: Int)] = [:]
        for f in folders where !isGenericFolder(f) {
            let name = f!.trimmingCharacters(in: .whitespacesAndNewlines)
            let k = name.lowercased()
            if counts[k] == nil { order.append(k); counts[k] = (name, 0) }
            counts[k]!.n += 1
        }
        var best: (name: String, n: Int)?
        for k in order { let c = counts[k]!; if best == nil || c.n > best!.n { best = c } }
        guard let b = best, Double(b.n) >= 0.6 * Double(folders.count) else { return nil }
        return b.name
    }

    /// Lexicon rule (9.4.3): the subject whose words occur most, when it clears the bar.
    public static func lexiconCategory(_ text: String) -> String? {
        let toks = WebText.tokens(text).map(\.stem)
        guard !toks.isEmpty else { return nil }
        var best: (name: String, hits: Int)?
        for c in loaded.categories {
            var hits = 0
            var distinct = Set<String>()
            for t in toks where c.stems.contains(t) { hits += 1; distinct.insert(t) }
            if distinct.count < 3 || Double(hits) < max(4, 0.02 * Double(toks.count)) { continue }
            if best == nil || hits > best!.hits { best = (c.name, hits) }
        }
        return best?.name
    }

    public static func coursePrefixCategory(_ text: String) -> String? {
        guard let c = Grouper.courseCode(in: text), let letters = c.display.split(separator: " ").first else { return nil }
        return loaded.prefixes[String(letters)]
    }

    public static func categorize(title: String, type: String?, pages: [Page]) -> String {
        let head = ([title] + pages.prefix(2).map { [$0.sourceName ?? "", $0.heading ?? "", String($0.text.prefix(300))].joined(separator: "\n") })
            .joined(separator: "\n")
        return coursePrefixCategory(head)
            ?? sharedFolder(pages.map(\.folder))
            ?? lexiconCategory(([title] + pages.map(\.text)).joined(separator: "\n"))
            ?? fallback[type ?? "book"] ?? "General"
    }
}

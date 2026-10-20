import Foundation

// MARK: - Grouping v2 (spec 8.3)

public extension Grouper {
    static let courseRegex = try! NSRegularExpression(pattern: "\\b([A-Z]{2,5})\\s?-?(\\d{2,4}[A-Z]?)\\b")
    static let lectureLike = try! NSRegularExpression(pattern: "(?i)\\b(lecture|lec|week|slides?|syllabus|seminar|lab|midterm|exam|course|class)\\b")
    /// Words that name a session, not the course ("BIO 101 Lecture 5" is titled "BIO 101", spec 9.5.2).
    static let sessionWord = try! NSRegularExpression(pattern: "^(lecture|lec|week|wk|notes?|slides?|lab|chapter|ch|unit|session|part|midterm|final|exam|quiz|hw|homework)$", options: [.caseInsensitive])
    static let capitalWord = try! NSRegularExpression(pattern: "^[A-Z&][\\p{L}&'-]*$")

    static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }

    /// Course name after a code: the leading capitalized words (up to 4) of the same line, stopping at session words.
    static func followingWords(_ after: String) -> String {
        let line = after.components(separatedBy: .newlines).first ?? ""
        let stripped = line.replacingOccurrences(of: "^[\\s:\\-\u{2013}|,.]+", with: "", options: .regularExpression)
        var out: [String] = []
        for raw in stripped.split(whereSeparator: { $0.isWhitespace }).prefix(4).map(String.init) {
            // "Biology," ends the name but still belongs to it.
            let w = raw.replacingOccurrences(of: "[,.:;]+$", with: "", options: .regularExpression)
            guard matches(capitalWord, w), !matches(sessionWord, w) else { break }
            out.append(w)
            if w != raw { break }
        }
        return out.joined(separator: " ").replacingOccurrences(of: "[,.:;]+$", with: "", options: .regularExpression)
    }

    /// First course code in a text, as (key "BIO101", display "BIO 101", following words).
    static func courseCode(in text: String) -> (key: String, display: String, following: String)? {
        let ns = text as NSString
        for m in courseRegex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            let letters = ns.substring(with: m.range(at: 1)), digits = ns.substring(with: m.range(at: 2))
            if ["PAGE", "FIG", "ISBN", "COVID", "ISO", "MP", "AM", "PM", "CH", "VOL", "NO", "TABLE", "ID", "PDF", "USB", "UTC", "GMT"].contains(letters) { continue }
            let following = followingWords(ns.substring(from: m.range.location + m.range.length))
            return (letters + digits, "\(letters) \(digits)", following)
        }
        return nil
    }

    static func contentTokens(_ s: String) -> Set<String> { Set(TextKit.tokens(s)) }

    /// Words following each mention of a course code (by key).
    static func allFollowing(_ key: String, in text: String) -> [String] {
        let ns = text as NSString
        var out: [String] = []
        for m in courseRegex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            let k = ns.substring(with: m.range(at: 1)) + ns.substring(with: m.range(at: 2))
            guard k == key else { continue }
            let f = followingWords(ns.substring(from: m.range.location + m.range.length))
            if !f.isEmpty { out.append(f) }
        }
        return out
    }

    static func guessType(_ pages: [Page], hasCourse: Bool) -> String {
        if pages.contains(where: { $0.kind == "screenshot" || $0.verbatim == true || ($0.kind == "note" && $0.suggestedAuthor != nil) }) { return "book" }
        if hasCourse || pages.contains(where: { $0.kind == "slides" }) { return "class" }
        if pages.contains(where: { p in courseCode(in: [p.sourceName ?? "", p.heading ?? "", String(p.text.prefix(300))].joined(separator: "\n")) != nil }) { return "class" }
        // Lecture-like names count for files only; a note called "Lab safety" is not a class.
        if pages.contains(where: { p in
            guard let n = p.sourceName, p.noteId == nil else { return false }
            return matches(lectureLike, n)
        }) { return "class" }
        return "other"
    }

    /// Port of the web cleanFileTitle (note titles must clean the same way on both platforms).
    static func webCleanFileTitle(_ name: String) -> String {
        func re(_ s: String, _ p: String, _ w: String, _ ci: Bool = true) -> String {
            s.replacingOccurrences(of: p, with: w, options: ci ? [.regularExpression, .caseInsensitive] : [.regularExpression])
        }
        let base = re(re(name, "\\.[a-z0-9]{1,5}$", ""), "[_]+", " ", false)
        var t = re(base, "\\b(lecture|lec|week|wk|slides?|notes?|chapter|ch|unit|session|class|part)\\s*[-#.]?\\s*\\d+[a-z]?\\b", " ")
        t = re(t, "\\b(lecture|lec|slides?|notes?|handout|final|draft|v\\d+)\\b", " ")
        t = re(re(t, "^[\\s\\-:.,]+|[\\s\\-:.,]+$", "", false), "\\s*[-:]\\s*[-:]\\s*", " - ", false)
        t = re(t, "\\s+", " ", false).trimmingCharacters(in: .whitespacesAndNewlines)
        t = re(re(re(re(t, "^[-:]\\s*", "", false), "\\s*[-:]$", "", false), "\\s+:\\s*", ": ", false), "^[:\\s]+", "", false)
        if t.isEmpty { t = base.trimmingCharacters(in: .whitespacesAndNewlines) }
        return t.prefix(1).uppercased() + t.dropFirst()
    }

    static let byAuthor = try! NSRegularExpression(pattern: "^(.+?)\\s+by\\s+([A-Z][\\p{L}.'-]*(?:\\s+[A-Z][\\p{L}.'-]*){0,3})$")

    /// Note title cleaned like a file name, plus "Notes on X", "X summary", dates and "X by Author" (9.5.1).
    static func cleanNoteTitle(_ raw: String) -> (title: String, author: String?) {
        var t = raw.replacingOccurrences(of: "\\b\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?\\b", with: " ", options: .regularExpression)
        t = TextKit.collapseWhitespace(t)
        t = t.replacingOccurrences(of: "^(?:notes on|notes from|summary of|thoughts on)\\s+", with: "", options: [.regularExpression, .caseInsensitive])
        t = t.replacingOccurrences(of: "\\s+(?:notes|summary)$", with: "", options: [.regularExpression, .caseInsensitive])
        t = webCleanFileTitle(t).replacingOccurrences(of: "[\\s\\-:.,]+$", with: "", options: .regularExpression)
        if t.isEmpty { t = raw.trimmingCharacters(in: .whitespacesAndNewlines) }
        let ns = t as NSString
        if let m = byAuthor.firstMatch(in: t, range: NSRange(location: 0, length: ns.length)) {
            return (ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespaces), ns.substring(with: m.range(at: 2)).trimmingCharacters(in: .whitespaces))
        }
        return (t, nil)
    }

    /// Title key like the web: lowercase, punctuation and symbols removed, digits kept.
    static func titleKey(_ s: String) -> String {
        let scalars = s.lowercased().unicodeScalars.map { u -> Character in
            CharacterSet.punctuationCharacters.contains(u) || CharacterSet.symbols.contains(u) ? " " : Character(u)
        }
        return TextKit.collapseWhitespace(String(scalars))
    }

    /// Per-group facts the final pass needs (keyed by SuggestedGroup.id).
    struct GroupMeta { var key = ""; var units = 0; var book = false; var course = false; var category: String? = nil; var words = false }

    static func group(_ pages: [Page]) -> [SuggestedGroup] {
        var out: [SuggestedGroup] = []
        var meta: [String: GroupMeta] = [:]
        // 1. suggestedTitle first (Books footer, user edits).
        var titled: [String: Int] = [:]
        var rest: [Page] = []
        for p in pages {
            if let t = p.suggestedTitle?.trimmingCharacters(in: .whitespaces), !t.isEmpty {
                let k = titleKey(t)
                if let i = titled[k] { out[i].pageIds.append(p.id); if out[i].author == nil { out[i].author = p.suggestedAuthor } }
                else {
                    titled[k] = out.count
                    let g = SuggestedGroup(title: t, author: p.suggestedAuthor, pageIds: [p.id])
                    meta[g.id] = GroupMeta(key: k)
                    out.append(g)
                }
            } else { rest.append(p) }
        }

        // Word lists go into one "Words" group before any other rule (spec 10.2).
        let wordPages = rest.filter { !($0.words ?? []).isEmpty }
        if !wordPages.isEmpty {
            rest.removeAll { !($0.words ?? []).isEmpty }
            let g = SuggestedGroup(title: words, pageIds: wordPages.map(\.id), type: "other", category: "Vocabulary")
            meta[g.id] = GroupMeta(key: "w:words", category: "Vocabulary", words: true)
            out.append(g)
        }

        // File and note units: non-screenshot, non-photo pages with a source file, and Apple Notes (spec 9.5).
        // Pages of one file or note stay together.
        var fileOrder: [String] = []
        var files: [String: [Page]] = [:]
        var photos: [Page] = []
        var loose: [Page] = []
        var noteUnitIds = Set<String>()
        for p in rest {
            if let nid = p.noteId, !nid.isEmpty {
                let k = "n:" + nid
                if files[k] == nil { fileOrder.append(k) }
                files[k, default: []].append(p)
                noteUnitIds.insert(p.id)
            } else if let n = p.sourceName, p.kind != "screenshot", p.kind != "photo" {
                let k = "f:" + n
                if files[k] == nil { fileOrder.append(k) }
                files[k, default: []].append(p)
            } else if p.kind == "photo" { photos.append(p) } else { loose.append(p) }
        }

        // 2. Course codes on a unit's first 2 pages.
        struct FileUnit { var name: String; var title: String; var author: String?; var pages: [Page]; var course: (key: String, display: String, following: String)? }
        var units: [FileUnit] = fileOrder.map { k in
            let ps = files[k]!.sorted { ($0.sourceIndex ?? 0) < ($1.sourceIndex ?? 0) }
            let n = ps.first?.sourceName ?? ""
            let head = ps.prefix(2).map { [$0.heading ?? "", $0.header ?? "", $0.text].joined(separator: "\n") }.joined(separator: "\n")
            var course = courseCode(in: n + "\n" + head)
            // Collect the words after every mention of the code, so the most common name wins.
            if let c = course {
                var seen = Set<String>()
                let f = allFollowing(c.key, in: n + "\n" + head).filter { seen.insert($0.lowercased()).inserted }
                course = (c.key, c.display, f.joined(separator: "\u{1}"))
            }
            if k.hasPrefix("n:") {
                let t = cleanNoteTitle(n.isEmpty ? (ps.first?.heading ?? "Note") : n)
                return FileUnit(name: n, title: t.title, author: t.author, pages: ps, course: course)
            }
            let title = ps.first?.header ?? ps.first?.heading ?? DocumentParser.cleanFileName(n)
            return FileUnit(name: n, title: title, pages: ps, course: course)
        }
        // Photos join a course too when their text names it.
        var coursePiles: [String: (display: String, following: [String], ids: [String], files: [FileUnit])] = [:]
        var courseOrder: [String] = []
        var plainUnits: [FileUnit] = []
        for u in units {
            if let c = u.course {
                if coursePiles[c.key] == nil { courseOrder.append(c.key); coursePiles[c.key] = (c.display, [], [], []) }
                coursePiles[c.key]!.following += c.following.components(separatedBy: "\u{1}").filter { !$0.isEmpty }
                coursePiles[c.key]!.ids += u.pages.map(\.id)
                coursePiles[c.key]!.files.append(u)
            } else { plainUnits.append(u) }
        }
        units = plainUnits
        var remainingPhotos: [Page] = []
        for p in photos {
            if let c = courseCode(in: (p.heading ?? "") + "\n" + p.text), coursePiles[c.key] != nil { coursePiles[c.key]!.ids.append(p.id) }
            else { remainingPhotos.append(p) }
        }
        for k in courseOrder {
            let c = coursePiles[k]!
            let counts = Dictionary(grouping: c.following, by: { $0.lowercased() }).mapValues(\.count)
            let best = counts.max { $0.value < $1.value || ($0.value == $1.value && $0.key > $1.key) }?.key
            let display = c.following.first { $0.lowercased() == best } ?? ""
            let title = display.isEmpty ? c.display : "\(c.display): \(TextKit.titleCase(display))"
            let g = SuggestedGroup(title: title, pageIds: c.ids, type: "class")
            meta[g.id] = GroupMeta(key: "c:" + k, course: true)
            out.append(g)
        }

        // 3. Each remaining unit; units whose titles share >= 50% of content tokens merge.
        var merged: [(title: String, author: String?, titles: [String], units: [FileUnit])] = []
        for u in units {
            let tu = contentTokens(u.title)
            if let i = merged.firstIndex(where: { m in
                m.titles.contains { t in
                    let tm = contentTokens(t)
                    let small = min(tu.count, tm.count)
                    return small > 0 && Double(tu.intersection(tm).count) / Double(small) >= 0.5
                }
            }) {
                merged[i].units.append(u); merged[i].titles.append(u.title)
                if merged[i].author == nil { merged[i].author = u.author }
            } else { merged.append((u.title, u.author, [u.title], [u])) }
        }
        for m in merged {
            let ps = m.units.flatMap(\.pages)
            let k = titleKey(m.title)
            // Same title as a Books-excerpt group: one project.
            if let i = titled[k] {
                out[i].pageIds += ps.map(\.id)
                if out[i].author == nil { out[i].author = m.author }
                meta[out[i].id]!.units += m.units.count
                if m.author != nil { meta[out[i].id]!.book = true }
                continue
            }
            titled[k] = out.count
            let g = SuggestedGroup(title: m.title, author: m.author, pageIds: ps.map(\.id))
            meta[g.id] = GroupMeta(key: k, units: m.units.count, book: m.author != nil)
            out.append(g)
        }

        // 4. Photos taken within 3 hours of each other form one pile.
        let sortedPhotos = remainingPhotos.sorted { (ISO.date($0.createdAt) ?? .distantPast) < (ISO.date($1.createdAt) ?? .distantPast) }
        var piles: [[Page]] = []
        for p in sortedPhotos {
            let d = ISO.date(p.createdAt) ?? .distantPast
            if let last = piles.last?.last, let ld = ISO.date(last.createdAt), d.timeIntervalSince(ld) <= 3 * 3600 { piles[piles.count - 1].append(p) }
            else { piles.append([p]) }
        }
        for pile in piles {
            let heading = pile.compactMap { $0.heading }.first ?? DocumentParser.guessHeading(pile[0].text)
            let date = ISO.date(pile[0].createdAt).map { d -> String in let f = DateFormatter(); f.dateFormat = "MMM d"; return f.string(from: d) } ?? ""
            out.append(SuggestedGroup(title: heading ?? "Notes from \(date)", pageIds: pile.map(\.id)))
        }

        // Screenshots and notes: header rule and similarity.
        for g in groupLoose(loose) {
            if g.title == unsorted, let i = out.firstIndex(where: { $0.title == unsorted }) { out[i].pageIds += g.pageIds } else { out.append(g) }
        }

        mergeSameBooks(&out, meta: &meta)
        attachLoneNotes(&out, meta: &meta, pages: pages, noteUnitIds: noteUnitIds)

        // Types and categories, after every page has its group.
        let byId = Dictionary(pages.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for i in out.indices {
            let ps = out[i].pageIds.compactMap { byId[$0] }
            let m = meta[out[i].id] ?? GroupMeta()
            out[i].pageIds = PageNumbers.ordered(ps).map(\.id)
            if m.words || (out[i].title == words && !ps.isEmpty && ps.allSatisfy({ !($0.words ?? []).isEmpty })) { out[i].type = "other"; out[i].category = "Vocabulary"; continue }
            out[i].type = m.book ? "book" : m.course ? "class" : guessType(ps, hasCourse: courseCode(in: out[i].title) != nil)
            out[i].category = m.category ?? Categories.categorize(title: out[i].title == unsorted ? "" : out[i].title, type: out[i].type, pages: ps)
        }
        // Biggest first, Unsorted last (stable), like the web app.
        return out.enumerated().sorted { a, b in
            let ua = a.element.title == unsorted, ub = b.element.title == unsorted
            if ua != ub { return ub }
            if a.element.pageIds.count != b.element.pageIds.count { return a.element.pageIds.count > b.element.pageIds.count }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// Spec 10.4: groups whose titles name the same book merge (not courses, Words or Unsorted; buckets come later).
    /// The bigger group's title wins (ties: the shorter title); authors that differ block the merge.
    static func mergeSameBooks(_ out: inout [SuggestedGroup], meta: inout [String: GroupMeta]) {
        func eligible(_ g: SuggestedGroup) -> Bool {
            let m = meta[g.id] ?? GroupMeta()
            return !m.course && !m.words && g.title != unsorted
        }
        var changed = true
        while changed {
            changed = false
            outer: for i in out.indices where eligible(out[i]) {
                for j in out.indices where j > i && eligible(out[j]) {
                    guard Identity.sameWork(title: out[i].title, author: out[i].author, title: out[j].title, author: out[j].author) else { continue }
                    let a = out[i], b = out[j]
                    let keepB = b.pageIds.count > a.pageIds.count || (b.pageIds.count == a.pageIds.count && b.title.count < a.title.count)
                    out[i].title = keepB ? b.title : a.title
                    out[i].author = a.author ?? b.author
                    out[i].pageIds = a.pageIds + b.pageIds
                    var m = meta[a.id] ?? GroupMeta()
                    let mb = meta[b.id] ?? GroupMeta()
                    m.units += mb.units
                    m.book = m.book || mb.book
                    meta[a.id] = m
                    meta[b.id] = nil
                    out.remove(at: j)
                    changed = true
                    break outer
                }
            }
        }
    }

    static let smallNotePages = 4
    static let attachCosine = 0.2

    /// Spec 9.5.3-4: a lone note (one note unit, < 4 pages, no author) joins the most similar group of >= 4
    /// pages (cosine >= 0.2), else is bucketed by shared folder, then lexicon category, else "Loose notes".
    static func attachLoneNotes(_ out: inout [SuggestedGroup], meta: inout [String: GroupMeta], pages: [Page], noteUnitIds: Set<String>) {
        let byId = Dictionary(pages.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let candidates = out.indices.filter { out[$0].title != unsorted }
        let small = candidates.filter { i in
            let m = meta[out[i].id] ?? GroupMeta()
            return m.units == 1 && !m.book && !m.course && out[i].pageIds.count < smallNotePages && out[i].pageIds.allSatisfy(noteUnitIds.contains)
        }
        guard !small.isEmpty else { return }
        let big = candidates.filter { out[$0].pageIds.count >= smallNotePages && !(meta[out[$0].id]?.words ?? false) }
        func text(_ i: Int) -> String { ([out[i].title] + out[i].pageIds.compactMap { byId[$0]?.text }).joined(separator: "\n") }
        let vecs = WebText.tfidf((big + small).map { WebText.tokens(text($0)).map(\.stem) })
        var bucketOrder: [String] = []
        var buckets: [String: SuggestedGroup] = [:]
        for (si, i) in small.enumerated() {
            let v = vecs[big.count + si]
            var best = -1
            var bestScore = attachCosine - 1e-9
            for (bi, _) in big.enumerated() {
                let c = v.cosine(vecs[bi])
                if c > bestScore { bestScore = c; best = bi }
            }
            if best >= 0 { out[big[best]].pageIds += out[i].pageIds; continue }
            let ps = out[i].pageIds.compactMap { byId[$0] }
            let folder = Categories.sharedFolder(ps.map(\.folder))
            let cat = folder == nil ? Categories.lexiconCategory(text(i)) : nil
            let key = folder.map { "f:" + $0.lowercased() } ?? cat.map { "k:" + $0 } ?? "loose"
            if buckets[key] == nil {
                bucketOrder.append(key)
                let g = SuggestedGroup(title: folder ?? cat.map { "\($0) notes" } ?? "Loose notes", pageIds: [])
                meta[g.id] = GroupMeta(key: "b" + key, category: cat)
                buckets[key] = g
            }
            buckets[key]!.pageIds += out[i].pageIds
        }
        let removed = Set(small)
        out = out.enumerated().filter { !removed.contains($0.offset) }.map(\.element) + bucketOrder.map { buckets[$0]! }
    }
}

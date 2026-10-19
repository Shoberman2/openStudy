import Foundation

// MARK: - Grouping v2 (spec 8.3)

public extension Grouper {
    static let courseRegex = try! NSRegularExpression(pattern: "\\b([A-Z]{2,5})\\s?-?(\\d{2,4}[A-Z]?)\\b")
    static let lectureLike = try! NSRegularExpression(pattern: "(?i)\\b(lecture|lec|week|slides?|syllabus|seminar|lab|midterm|exam|course|class)\\b")

    /// First course code in a text, as (key "BIO101", display "BIO 101", following words).
    static func courseCode(in text: String) -> (key: String, display: String, following: String)? {
        let ns = text as NSString
        for m in courseRegex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            let letters = ns.substring(with: m.range(at: 1)), digits = ns.substring(with: m.range(at: 2))
            if ["PAGE", "FIG", "ISBN", "COVID", "ISO", "MP", "AM", "PM", "CH", "VOL", "NO"].contains(letters) { continue }
            let after = ns.substring(from: m.range.location + m.range.length)
            let line = after.components(separatedBy: .newlines).first ?? ""
            let words = line.replacingOccurrences(of: "^[\\s:\\-\u{2013}.,]+", with: "", options: .regularExpression)
                .components(separatedBy: CharacterSet(charactersIn: ".,;()|\u{2013}")).first ?? ""
            let following = TextKit.words(words).prefix(4).joined(separator: " ")
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
            let after = ns.substring(from: m.range.location + m.range.length)
            let line = after.components(separatedBy: .newlines).first ?? ""
            let words = line.replacingOccurrences(of: "^[\\s:\\-\u{2013}.,]+", with: "", options: .regularExpression)
                .components(separatedBy: CharacterSet(charactersIn: ".,;()|\u{2013}")).first ?? ""
            let f = TextKit.words(words).prefix(4).joined(separator: " ")
            if !f.isEmpty { out.append(f) }
        }
        return out
    }

    static func guessType(_ pages: [Page], hasCourse: Bool) -> String {
        if pages.contains(where: { $0.kind == "screenshot" || $0.verbatim == true || ($0.kind == "note" && $0.suggestedAuthor != nil) }) { return "book" }
        if hasCourse || pages.contains(where: { $0.kind == "slides" }) { return "class" }
        if pages.contains(where: { p in
            guard let n = p.sourceName else { return false }
            return lectureLike.firstMatch(in: n, range: NSRange(location: 0, length: (n as NSString).length)) != nil
        }) { return "class" }
        return "other"
    }

    static func group(_ pages: [Page]) -> [SuggestedGroup] {
        var out: [SuggestedGroup] = []
        // 1. suggestedTitle first (Books footer, user edits).
        var titled: [String: Int] = [:]
        var rest: [Page] = []
        for p in pages {
            if let t = p.suggestedTitle?.trimmingCharacters(in: .whitespaces), !t.isEmpty {
                let k = TextKit.normalizeKey(t)
                if let i = titled[k] { out[i].pageIds.append(p.id); if out[i].author == nil { out[i].author = p.suggestedAuthor } }
                else { titled[k] = out.count; out.append(SuggestedGroup(title: t, author: p.suggestedAuthor, pageIds: [p.id])) }
            } else { rest.append(p) }
        }

        // File units: non-screenshot, non-photo pages with a source file. Pages of one file stay together.
        var fileOrder: [String] = []
        var files: [String: [Page]] = [:]
        var photos: [Page] = []
        var loose: [Page] = []
        for p in rest {
            if let n = p.sourceName, p.kind != "screenshot", p.kind != "photo" {
                if files[n] == nil { fileOrder.append(n) }
                files[n, default: []].append(p)
            } else if p.kind == "photo" { photos.append(p) } else { loose.append(p) }
        }

        // 2. Course codes on a file's first 2 pages.
        struct FileUnit { var name: String; var title: String; var pages: [Page]; var course: (key: String, display: String, following: String)? }
        var units: [FileUnit] = fileOrder.map { n in
            let ps = files[n]!.sorted { ($0.sourceIndex ?? 0) < ($1.sourceIndex ?? 0) }
            let head = ps.prefix(2).map { [$0.heading ?? "", $0.header ?? "", $0.text].joined(separator: "\n") }.joined(separator: "\n")
            var course = courseCode(in: n + "\n" + head)
            // Collect the words after every mention of the code, so the most common name wins.
            if let c = course {
                var seen = Set<String>()
                let f = allFollowing(c.key, in: n + "\n" + head).filter { seen.insert($0.lowercased()).inserted }
                course = (c.key, c.display, f.joined(separator: "\u{1}"))
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
            out.append(SuggestedGroup(title: title, pageIds: c.ids, type: "class"))
        }

        // 3. Each remaining file is a unit; files whose titles share >= 50% of content tokens merge.
        var merged: [(title: String, units: [FileUnit])] = []
        for u in units {
            let tu = contentTokens(u.title)
            if let i = merged.firstIndex(where: { m in
                let tm = contentTokens(m.title)
                let small = min(tu.count, tm.count)
                return small > 0 && Double(tu.intersection(tm).count) / Double(small) >= 0.5
            }) { merged[i].units.append(u) } else { merged.append((u.title, [u])) }
        }
        for m in merged {
            let ps = m.units.flatMap(\.pages)
            out.append(SuggestedGroup(title: m.title, pageIds: ps.map(\.id), type: guessType(ps, hasCourse: false)))
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
            let title = heading ?? "Notes from \(date)"
            out.append(SuggestedGroup(title: title, pageIds: pile.map(\.id), type: guessType(pile, hasCourse: false)))
        }

        // Screenshots and notes: header rule and similarity.
        for g in groupLoose(loose) {
            var gg = g
            gg.type = guessType(loose.filter { g.pageIds.contains($0.id) }, hasCourse: false)
            if g.title == unsorted, let i = out.firstIndex(where: { $0.title == unsorted }) { out[i].pageIds += g.pageIds } else { out.append(gg) }
        }
        // Types for titled groups.
        let byId = Dictionary(uniqueKeysWithValues: pages.map { ($0.id, $0) })
        for i in out.indices where titled.values.contains(i) {
            let ps = out[i].pageIds.compactMap { byId[$0] }
            out[i].type = guessType(ps, hasCourse: courseCode(in: out[i].title) != nil)
        }
        return out
    }
}

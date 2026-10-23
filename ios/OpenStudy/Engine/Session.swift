import Foundation

// MARK: - Exercises (spec 5.1)

public enum ExerciseKind: String, CaseIterable {
    case mc, tf, bank, type, match, flash, apply
    case defMc = "def-mc", termType = "term-type", explain
    case qBank1 = "q-bank1", qBank3 = "q-bank3", qOrder = "q-order", qLetters = "q-letters", qRecall = "q-recall"
    case picture

    public var isQuote: Bool { rawValue.hasPrefix("q-") }
    public var isTyped: Bool { [.type, .apply, .qLetters, .qRecall, .termType, .explain].contains(self) }
}

public enum Segment: Equatable, Hashable {
    case text(String)
    case blank(Int, suffix: String)
}

public struct MatchPair: Equatable, Hashable {
    public var cardId: String
    public var term: String
    public var statement: String
}

public struct Exercise: Identifiable, Equatable {
    public var id: String = IDGen.make()
    public var kind: ExerciseKind
    public var cardIds: [String]
    public var body: String = ""
    public var options: [String] = []
    public var answer: String = ""
    public var segments: [Segment] = []
    public var blanks: [String] = []
    public var chunks: [String] = []
    public var pairs: [MatchPair] = []
    public var tfIsTrue: Bool = true
    public var attribution: String?
    public var hint: String?
    public var isRetry = false
    /// The page a picture exercise shows (spec 11.2).
    public var pageId: String?
    /// Lines from the page shown above an mc prompt, and which mc form this is (spec 13.7).
    public var context: [String] = []
    public var form: String?

    public var cardId: String { cardIds.first ?? "" }

    public var instruction: String {
        switch kind {
        case .mc: return "Choose the right answer"
        case .tf: return "True or false?"
        case .bank: return "Fill in the blank"
        case .type: return "Type the answer"
        case .match: return "Match the pairs"
        case .flash: return "Recall it, then check"
        case .apply: return "How would you use this?"
        case .defMc: return "Pick the definition"
        case .termType: return "Type the term"
        case .explain: return "Teach it back"
        case .qBank1, .qBank3: return "Complete the quote"
        case .qOrder: return "Put the quote in order"
        case .qLetters: return "Type the quote from the first letters"
        case .qRecall: return "Write the quote from memory"
        case .picture: return "Recall what this page shows"
        }
    }
}

// MARK: - Session builder (spec 5.2)

public enum SessionBuilder {
    /// Class lessons by level (spec 13.4, replaces 8.5).
    public static func classMix(level: Int) -> [ExerciseKind] {
        switch level {
        case ...0: return [.defMc, .mc, .tf]
        case 1: return [.defMc, .mc, .tf]
        case 2: return [.termType, .mc, .tf]
        case 3: return [.termType, .mc, .explain]
        default: return [.termType, .mc, .tf, .explain]
        }
    }

    /// Theme lessons by level (spec 13.4, replaces 5.2). No word bank, match or typed blank: a missing word
    /// only shows up when the lesson has no concept card left for an mc or tf slot.
    public static func themeMix(level: Int) -> [ExerciseKind] {
        switch level {
        case ...0: return [.mc, .tf, .mc]
        case 1: return [.mc, .tf, .mc]
        case 2: return [.mc, .tf, .explain]
        case 3: return [.mc, .tf, .explain]
        default: return [.mc, .tf, .explain, .apply]
        }
    }

    public static func quoteMix(level: Int) -> [ExerciseKind] {
        switch level {
        case ...0: return [.qBank1]
        case 1: return [.qBank1, .qBank3]
        case 2: return [.qBank3, .qOrder]
        case 3: return [.qOrder, .qLetters]
        default: return [.qLetters, .qRecall]
        }
    }

    static func weight(_ k: ExerciseKind, _ practice: [String]) -> Int {
        switch k {
        case .mc, .tf, .match, .defMc: return practice.contains("tap") ? 2 : 1
        case .termType: return practice.contains("type") ? 2 : 1
        case .bank: return practice.contains("blank") ? 2 : 1
        case .type: return practice.contains("type") ? 2 : 1
        default: return 1
        }
    }

    public static func isDue(_ c: Card, now: Date) -> Bool { c.srs.state != "new" && c.srs.dueDate <= now }

    /// Due first (oldest first), then new, then least recently seen (earliest due).
    public static func orderCards(_ cards: [Card], now: Date) -> [Card] {
        let due = cards.filter { isDue($0, now: now) }.sorted { $0.srs.dueDate < $1.srs.dueDate }
        let new = cards.filter { $0.srs.state == "new" }
        let rest = cards.filter { $0.srs.state != "new" && !isDue($0, now: now) }.sorted { $0.srs.dueDate < $1.srs.dueDate }
        return due + new + rest
    }

    public static func build<R: RandomNumberGenerator>(lesson: Lesson, cards: [Card], projectCards: [Card] = [], profile: Profile, isClass: Bool = false, now: Date = Date(), rng: inout R) -> [Exercise] {
        let all = cards.filter { $0.lessonId == lesson.id }
        guard !all.isEmpty else { return [] }
        // Picture cards (spec 11.2) play only as picture exercises, at most 3, never first.
        let pictures = orderCards(all.filter(\.isPicture), now: now)
        let own = all.filter { !$0.isPicture }
        let sessionLength = lesson.isQuotes ? 8 : 10
        if own.isEmpty { return pictures.prefix(sessionLength).map(picture) }
        let nPictures = min(PictureCards.maxPerSession, pictures.count)
        let pool = orderCards(own, now: now)
        let length = sessionLength - nPictures
        let mix = lesson.isQuotes ? quoteMix(level: lesson.level) : isClass ? classMix(level: lesson.level) : themeMix(level: lesson.level)
        let extraWords = (projectCards.isEmpty ? cards : projectCards).filter { !$0.isPicture }.flatMap { longWords($0.statement) }
        let defs = (projectCards.isEmpty ? cards : projectCards).filter(\.isDefinition)

        var sequence = pool.map(\.id) + pool.map(\.id) // each card at most twice
        let byId = Dictionary(uniqueKeysWithValues: own.map { ($0.id, $0) })
        var out: [Exercise] = []
        // Explain and apply share one slot per session (spec 13.4).
        var deepUsed = false
        var usedIds = Set<String>()
        var mcSlots = 0
        var asked = Set<String>()
        let pagePool = projectCards.isEmpty ? cards : projectCards
        let flashSlot = profile.practice.contains("flash") && !lesson.isQuotes ? min(3, length - 1) : -1

        while out.count < length, !sequence.isEmpty {
            var kind: ExerciseKind
            if out.count == flashSlot { kind = .flash }
            else { kind = weightedPick(mix, profile.practice, &rng) }
            if (kind == .type || kind == .termType) && out.isEmpty { kind = lesson.isQuotes ? .qBank1 : (isClass ? .defMc : .mc) }
            // An explain or apply slot that cannot be used becomes mc, never a typed blank (spec 13.4).
            if (kind == .explain || kind == .apply) && (out.isEmpty || deepUsed) { kind = .mc }
            if kind == .apply && !profile.goals.contains("apply") { kind = .mc }
            if kind == .match && out.last?.kind == .match { kind = .mc }
            if kind == .qRecall && out.isEmpty { kind = .qLetters }

            // mc slots rotate through concept and whole-page questions (spec 13.7).
            if kind == .mc {
                if let (card, e) = mixedMC(k: mcSlots, sequence: sequence, usedIds: usedIds, byId: byId, pool: pagePool, asked: &asked, extraWords: extraWords, defs: defs, rng: &rng) {
                    sequence.remove(at: sequence.firstIndex(of: card.id)!)
                    usedIds.insert(card.id)
                    out.append(e)
                    mcSlots += 1
                    continue
                }
                mcSlots += 1
                // Nothing left to ask about a page: a whole-sentence true or false beats a missing word.
                kind = .tf
            }

            // Pick the next card, avoiding an immediate repeat when possible.
            var idx = 0
            let last = out.last?.cardIds.last
            if let last, sequence.count > 1, sequence[0] == last,
               let alt = sequence.firstIndex(where: { $0 != last }) { idx = alt }
            // mc, tf and flash slots take the next concept card not yet used in this session first (spec 13.4).
            if kind == .mc || kind == .tf || kind == .flash,
               let ci = sequence.firstIndex(where: { !usedIds.contains($0) && byId[$0]!.isConcept }) { idx = ci }
            let card = byId[sequence[idx]]!
            sequence.remove(at: idx)

            if kind == .match, own.filter(\.isDefinition).count + (card.isDefinition ? 0 : 1) >= 4 || (card.isDefinition && defs.count >= 4) {
                // Prefer term <-> definition pairs whenever the lesson has definitions.
                var chosen: [Card] = card.isDefinition ? [card] : []
                if !card.isDefinition { sequence.insert(card.id, at: 0) }
                let pool = sequence.compactMap { byId[$0] } + own + defs
                for c in pool where chosen.count < 4 && c.isDefinition {
                    if !chosen.contains(where: { $0.id == c.id || $0.term?.lowercased() == c.term?.lowercased() }) { chosen.append(c) }
                }
                if chosen.count == 4 { usedIds.formUnion(chosen.map(\.id)); out.append(makeMatch(chosen, rng: &rng)); continue }
                if !card.isDefinition { sequence.removeFirst() }
            }
            if kind == .match {
                var others: [Card] = []
                var used = Set([card.id])
                var clozes = Set([(card.cloze ?? "").lowercased()])
                for id in sequence where others.count < 3 {
                    if let c = byId[id], !used.contains(c.id), let cz = c.cloze, !cz.isEmpty, !clozes.contains(cz.lowercased()) {
                        others.append(c); used.insert(c.id); clozes.insert(cz.lowercased())
                    }
                }
                if others.count == 3, card.cloze?.isEmpty == false {
                    usedIds.formUnion(([card] + others).map(\.id))
                    out.append(makeMatch([card] + others, rng: &rng))
                    continue
                }
                kind = .mc
            }
            var e = make(kind, card: card, extraWords: extraWords, defs: defs, rng: &rng)
            if e.kind == .explain && (e.hint ?? "").isEmpty {
                e.hint = lesson.title
                e.body = "Explain \(lesson.title) in your own words like you're teaching a friend."
            }
            if e.kind == .explain || e.kind == .apply { deepUsed = true }
            usedIds.formUnion(e.cardIds)
            out.append(e)
        }
        return insertPictures(out, Array(pictures.prefix(nPictures)), rng: &rng)
    }

    // MARK: Whole-page questions (spec 13.7)

    public enum PageForm: String, CaseIterable {
        case gist, odd, mate
        var prompt: String {
            switch self {
            case .gist: return "What's the main point of the page these lines come from?"
            case .odd: return "Three of these come from the same page. Which one doesn't fit?"
            case .mate: return "Which idea comes from the same page as this one?"
            }
        }
    }

    static let mcForms = ["concept", "gist", "odd", "mate"]

    /// Word count on whitespace, as on web.
    static func spaceCount(_ s: String) -> Int { s.split(whereSeparator: \.isWhitespace).count }

    static func takesPart(_ c: Card) -> Bool {
        c.kind == "fact" && (c.term ?? "").isEmpty && (4...25).contains(spaceCount(c.statement))
    }

    public static func pageMates(_ c: Card, pool: [Card]) -> [Card] {
        guard let page = c.pageId, takesPart(c) else { return [] }
        var seen: Set<String> = [AnswerChecker.normalize(c.statement)]
        return pool.filter { o in
            guard o.id != c.id, o.pageId == page, takesPart(o) else { return false }
            return seen.insert(AnswerChecker.normalize(o.statement)).inserted
        }
    }

    /// Statements from other pages: other lessons first, then closest in word count, then pool order.
    static func outsiders(_ c: Card, pool: [Card], target: Int, count: Int) -> [String] {
        var taken = Set(pool.filter { c.pageId != nil && $0.pageId == c.pageId }.map { AnswerChecker.normalize($0.statement) })
        taken.insert(AnswerChecker.normalize(c.statement))
        let cands = pool.enumerated()
            .filter { takesPart($0.element) && (c.pageId == nil || $0.element.pageId != c.pageId) }
            .sorted { a, b in
                let la = a.element.lessonId == c.lessonId ? 1 : 0, lb = b.element.lessonId == c.lessonId ? 1 : 0
                if la != lb { return la < lb }
                let da = abs(spaceCount(a.element.statement) - target), db = abs(spaceCount(b.element.statement) - target)
                return da != db ? da < db : a.offset < b.offset
            }
        var out: [String] = []
        for (_, o) in cands where out.count < count {
            if taken.insert(AnswerChecker.normalize(o.statement)).inserted { out.append(o.statement) }
        }
        return out
    }

    /// The page card sharing the most content words with the rest of the page; ties go to the earlier card.
    static func keyCard(_ set: [Card]) -> Card {
        let stems = set.map { Set(TextKit.tokens($0.statement)) }
        var best = 0, bestScore = -1
        for i in set.indices {
            var score = 0
            for s in stems[i] { for j in set.indices where j != i && stems[j].contains(s) { score += 1 } }
            if score > bestScore { best = i; bestScore = score }
        }
        return set[best]
    }

    public static func pageMC<R: RandomNumberGenerator>(_ c: Card, pool: [Card], form: PageForm, rng: inout R) -> Exercise? {
        let mates = pageMates(c, pool: pool)
        var e = Exercise(kind: .mc, cardIds: [c.id])
        e.form = form.rawValue
        e.body = form.prompt
        switch form {
        case .mate:
            guard let mate = mates.first else { return nil }
            let wrong = outsiders(c, pool: pool, target: spaceCount(mate.statement), count: 3)
            guard wrong.count == 3 else { return nil }
            e.context = [c.statement]
            e.answer = mate.statement
            e.options = ([mate.statement] + wrong).shuffled(using: &rng)
        case .odd:
            guard mates.count >= 2 else { return nil }
            let own = [c, mates[0], mates[1]].map(\.statement)
            let mean = Int((Double(own.map(spaceCount).reduce(0, +)) / 3).rounded())
            guard let odd = outsiders(c, pool: pool, target: mean, count: 1).first else { return nil }
            e.answer = odd
            e.options = (own + [odd]).shuffled(using: &rng)
        case .gist:
            guard mates.count >= 2 else { return nil }
            let set = [c] + mates
            let key = keyCard(set)
            let wrong = outsiders(c, pool: pool, target: spaceCount(key.statement), count: 3)
            guard wrong.count == 3 else { return nil }
            e.context = set.filter { $0.id != key.id }.prefix(2).map(\.statement)
            e.answer = key.statement
            e.options = ([key.statement] + wrong).shuffled(using: &rng)
        }
        return e
    }

    /// The k-th mc slot of a lesson: forms cycle from k and the first one that works wins, unused cards first.
    /// A gist or odd question is asked once per page, a mate question once per card.
    static func mixedMC<R: RandomNumberGenerator>(k: Int, sequence: [String], usedIds: Set<String>, byId: [String: Card], pool: [Card], asked: inout Set<String>,
                                                  extraWords: [String], defs: [Card], rng: inout R) -> (Card, Exercise)? {
        var seen = Set<String>()
        let order = sequence.filter { seen.insert($0).inserted }.compactMap { byId[$0] }
        for unusedOnly in [true, false] {
            let cands = order.filter { !unusedOnly || !usedIds.contains($0.id) }
            for i in 0..<mcForms.count {
                let name = mcForms[(k + i) % mcForms.count]
                guard let form = PageForm(rawValue: name) else {
                    if let c = cands.first(where: \.isConcept) {
                        var e = make(.mc, card: c, extraWords: extraWords, defs: defs, rng: &rng)
                        e.form = "concept"
                        return (c, e)
                    }
                    continue
                }
                for c in cands {
                    let key = form == .mate ? "mate:\(c.id)" : "\(name):\(c.pageId ?? "")"
                    if !asked.contains(key), let e = pageMC(c, pool: pool, form: form, rng: &rng) {
                        asked.insert(key)
                        return (c, e)
                    }
                }
            }
        }
        return nil
    }

    /// One card's mc outside a lesson: its concept question, else a page form, else a plain mc.
    static func cardMC<R: RandomNumberGenerator>(_ c: Card, pool: [Card], index: Int, extraWords: [String], defs: [Card] = [], rng: inout R) -> Exercise {
        if c.isConcept {
            var e = make(.mc, card: c, extraWords: extraWords, defs: defs, rng: &rng)
            e.form = "concept"
            return e
        }
        for i in 0..<PageForm.allCases.count {
            if let e = pageMC(c, pool: pool, form: PageForm.allCases[(index + i) % PageForm.allCases.count], rng: &rng) { return e }
        }
        return make(.mc, card: c, extraWords: extraWords, defs: defs, rng: &rng)
    }

    /// Exercises built from concept cards, for the `concepts` prop of `session_start` (spec 13.4).
    public static func conceptCount(_ exercises: [Exercise], cards: [Card]) -> Int {
        let ids = Set(cards.filter(\.isConcept).map(\.id))
        return exercises.filter { $0.cardIds.contains(where: ids.contains) }.count
    }

    static func picture(_ c: Card) -> Exercise {
        var e = Exercise(kind: .picture, cardIds: [c.id])
        e.pageId = c.pageId
        e.body = c.question ?? "What does this page show?"
        e.answer = c.statement
        return e
    }

    /// Picture exercises go at random positions after the first.
    static func insertPictures<R: RandomNumberGenerator>(_ out: [Exercise], _ pics: [Card], rng: inout R) -> [Exercise] {
        var res = out
        for c in pics {
            if res.isEmpty { res.append(picture(c)); continue }
            res.insert(picture(c), at: 1 + Int.random(in: 0..<res.count, using: &rng))
        }
        return res
    }

    public static func practice<R: RandomNumberGenerator>(cards: [Card], profile: Profile, now: Date = Date(), rng: inout R) -> [Exercise] {
        let dueAll = cards.filter { isDue($0, now: now) }.sorted { $0.srs.dueDate < $1.srs.dueDate }
        let duePictures = dueAll.filter(\.isPicture)
        let due = dueAll.filter { !$0.isPicture }
        if due.isEmpty { return duePictures.prefix(12).map(picture) }
        let nPictures = min(PictureCards.maxPerSession, duePictures.count)
        let size = 12 - nPictures
        // Interleave across projects.
        var buckets: [String: [Card]] = [:]
        var order: [String] = []
        for c in due { if buckets[c.projectId] == nil { order.append(c.projectId) }; buckets[c.projectId, default: []].append(c) }
        var picked: [Card] = []
        while picked.count < size, buckets.values.contains(where: { !$0.isEmpty }) {
            for p in order where picked.count < size { if let c = buckets[p]?.first { picked.append(c); buckets[p]!.removeFirst() } }
        }
        let extra = cards.filter { !$0.isPicture }.flatMap { longWords($0.statement) }
        var out: [Exercise] = []
        for c in picked {
            if c.isQuote {
                out.append(make(Bool.random(using: &rng) ? .qBank3 : .qLetters, card: c, extraWords: extra, rng: &rng))
            } else if !out.isEmpty && Double.random(in: 0..<1, using: &rng) >= 0.6 {
                // No word bank or typed blank in Practice (spec 13.7).
                out.append(make(.tf, card: c, extraWords: extra, rng: &rng))
            } else {
                out.append(cardMC(c, pool: cards.filter { !$0.isPicture }, index: out.count, extraWords: extra, rng: &rng))
            }
        }
        return insertPictures(out, Array(duePictures.prefix(nPictures)), rng: &rng)
    }

    public static func nextReview(_ cards: [Card]) -> Date? {
        cards.filter { $0.srs.state != "new" }.map(\.srs.dueDate).min()
    }

    static func weightedPick<R: RandomNumberGenerator>(_ kinds: [ExerciseKind], _ practice: [String], _ rng: inout R) -> ExerciseKind {
        let weights = kinds.map { weight($0, practice) }
        var r = Int.random(in: 0..<weights.reduce(0, +), using: &rng)
        for (k, w) in zip(kinds, weights) { if r < w { return k }; r -= w }
        return kinds[0]
    }

    // MARK: Exercise construction

    static func blanked(_ c: Card) -> String {
        guard let cz = c.cloze, !cz.isEmpty else { return c.question ?? c.statement }
        let b = LessonBuilder.replaceFirst(in: c.statement, cz, with: "____")
        return b == c.statement ? (c.question ?? c.statement) : b
    }

    /// A definition card whose answer is its term asks for the term (spec 10.10), never "What is <term>?".
    static func prompt(_ c: Card) -> String {
        if c.isDefinition, let a = c.answer, a.lowercased() == c.term!.lowercased() { return "Which term means: \(c.definition!)?" }
        return c.question ?? blanked(c)
    }

    static func longWords(_ s: String) -> [String] {
        TextKit.words(s).map { $0.trimmingCharacters(in: CharacterSet.punctuationCharacters) }
            .filter { $0.count >= 4 && !TextKit.isStop($0.lowercased()) && $0.allSatisfy { $0.isLetter || $0 == "'" || $0 == "\u{2019}" } }
    }

    static func make<R: RandomNumberGenerator>(_ requested: ExerciseKind, card c: Card, extraWords: [String], defs: [Card] = [], rng: inout R) -> Exercise {
        if c.isPicture { return picture(c) }
        var kind = requested
        if kind == .picture { kind = .mc }
        if (kind == .defMc || kind == .termType) && !c.isDefinition { kind = kind == .defMc ? .mc : .type }
        if c.isQuote, !kind.isQuote { kind = .qBank1 }
        if !c.isQuote, kind.isQuote { kind = .mc }
        var e = Exercise(kind: kind, cardIds: [c.id])
        e.attribution = c.attribution
        let distractors = c.distractors ?? []
        let hasCloze = !(c.cloze ?? "").isEmpty && c.statement.range(of: c.cloze!, options: .caseInsensitive) != nil

        switch kind {
        case .mc:
            if distractors.count >= 3, let a = c.answer ?? c.cloze {
                e.body = prompt(c)
                e.answer = a
                e.options = ([a] + distractors.prefix(3)).shuffled(using: &rng)
            } else { return make(.tf, card: c, extraWords: extraWords, rng: &rng) }
        case .tf:
            // A concept card pairs its question with the right answer or a wrong one (spec 13.4).
            if c.isConcept, let wrong = distractors.first {
                func pair(_ a: String) -> String {
                    var t = a
                    while let l = t.last, l == "." || l.isWhitespace { t.removeLast() }
                    return "\(c.question!) \(t)."
                }
                let truth = Bool.random(using: &rng)
                e.tfIsTrue = truth
                e.body = pair(truth ? c.answer! : wrong)
                e.answer = truth ? "True" : "False"
                e.hint = pair(c.answer!)
                e.options = ["True", "False"]
                break
            }
            let showTrue = c.falseStatement == nil || Bool.random(using: &rng)
            e.tfIsTrue = showTrue
            e.body = showTrue ? c.statement : c.falseStatement!
            e.answer = showTrue ? "True" : "False"
            e.hint = c.statement
            e.options = ["True", "False"]
        case .bank:
            guard hasCloze else { return make(.mc, card: c, extraWords: extraWords, rng: &rng) }
            let (segs, blanks) = segmentize(c.statement, targets: [c.cloze!])
            e.segments = segs; e.blanks = blanks
            e.answer = c.cloze!
            let fromStatement = longWords(c.statement).filter { $0.lowercased() != c.cloze!.lowercased() }
            var opts = [c.cloze!] + distractors.filter { TextKit.wordCount($0) <= 2 }.prefix(3)
            let statementWords = Set(TextKit.rawWords(c.statement))
            for w in extraWords.shuffled(using: &rng) where opts.count < 4 {
                if !statementWords.contains(w.lowercased()) && !opts.contains(where: { $0.lowercased() == w.lowercased() }) { opts.append(w.lowercased()) }
            }
            for w in fromStatement.shuffled(using: &rng) where opts.count < 6 && !opts.contains(where: { $0.lowercased() == w.lowercased() }) { opts.append(w) }
            e.options = opts.shuffled(using: &rng)
        case .type:
            if let a = c.answer, let q = c.question, TextKit.wordCount(a) <= 3, q != c.statement {
                e.body = c.isDefinition ? prompt(c) : q; e.answer = a
            } else if hasCloze {
                e.body = blanked(c); e.answer = c.cloze!
            } else {
                e.body = c.question ?? c.statement; e.answer = c.answer ?? c.statement
            }
        case .flash:
            e.body = prompt(c)
            e.answer = c.answer ?? c.cloze ?? c.statement
        case .apply:
            e.body = c.statement
            e.answer = c.statement
        case .defMc:
            let others = defs.filter { $0.id != c.id && $0.term?.lowercased() != c.term?.lowercased() && $0.definition != c.definition }
            guard others.count >= 3 else { return make(.mc, card: c, extraWords: extraWords, defs: defs, rng: &rng) }
            // Deterministic distractor order: same lesson first, then the rest.
            let ranked = others.filter { $0.lessonId == c.lessonId } + others.filter { $0.lessonId != c.lessonId }
            e.body = c.term!
            e.answer = c.definition!
            e.options = ([c.definition!] + ranked.prefix(3).map { $0.definition! }).shuffled(using: &rng)
        case .termType:
            e.body = c.definition!
            e.answer = c.term!
        case .explain:
            let topic = c.term ?? ""
            e.hint = topic
            e.body = topic.isEmpty ? "" : "Explain \(topic) in your own words like you're teaching a friend."
            e.answer = c.statement
        case .match, .picture:
            break
        case .qBank1, .qBank3:
            let targets = blankTargets(c.statement, count: kind == .qBank3 ? 3 : 1)
            if targets.isEmpty { return make(.qLetters, card: c, extraWords: extraWords, rng: &rng) }
            if kind == .qBank3 && targets.count < 3 { return make(.qBank1, card: c, extraWords: extraWords, rng: &rng) }
            let (segs, blanks) = segmentize(c.statement, targets: targets)
            e.segments = segs; e.blanks = blanks
            e.answer = c.statement
            let need = kind == .qBank3 ? 2 : 3
            var opts = blanks
            let lowered = Set(TextKit.rawWords(c.statement))
            for w in extraWords.shuffled(using: &rng) where opts.count < blanks.count + need {
                if !lowered.contains(w.lowercased()) && !opts.contains(where: { $0.lowercased() == w.lowercased() }) { opts.append(w.lowercased()) }
            }
            for w in longWords(c.statement) where opts.count < blanks.count + need && !opts.contains(where: { $0.lowercased() == w.lowercased() }) { opts.append(w) }
            e.options = opts.shuffled(using: &rng)
        case .qOrder:
            let ch = chunks(c.statement)
            if ch.count < 3 { return make(.qBank1, card: c, extraWords: extraWords, rng: &rng) }
            e.chunks = ch
            var shuffled = ch.shuffled(using: &rng)
            var tries = 0
            while shuffled == ch && tries < 8 { shuffled.shuffle(using: &rng); tries += 1 }
            e.options = shuffled
            e.answer = c.statement
        case .qLetters:
            e.hint = letterHint(c.statement)
            e.answer = c.statement
        case .qRecall:
            let ws = TextKit.words(c.statement)
            e.hint = ws.prefix(2).joined(separator: " ") + " \u{2026}"
            e.answer = c.statement
        }
        return e
    }

    static func makeMatch<R: RandomNumberGenerator>(_ cards: [Card], rng: inout R) -> Exercise {
        var e = Exercise(kind: .match, cardIds: cards.map(\.id))
        let allDefs = cards.allSatisfy(\.isDefinition)
        e.pairs = cards.map { c in
            allDefs ? MatchPair(cardId: c.id, term: c.term!, statement: TextKit.truncate(c.definition!, 70))
                    : MatchPair(cardId: c.id, term: c.cloze ?? "", statement: TextKit.truncate(blanked(c), 70))
        }
        e.options = e.pairs.map(\.term).shuffled(using: &rng)
        e.chunks = e.pairs.map(\.statement).shuffled(using: &rng)
        return e
    }

    /// Longest non-stopword words, in order of appearance.
    public static func blankTargets(_ text: String, count: Int) -> [String] {
        let ws = TextKit.words(text).map { $0.trimmingCharacters(in: CharacterSet.punctuationCharacters) }
        var seen = Set<String>()
        let candidates = ws.enumerated().filter { _, w in
            w.count >= 3 && !TextKit.isStop(w.lowercased()) && w.allSatisfy { $0.isLetter || $0 == "'" || $0 == "\u{2019}" }
        }.filter { seen.insert($0.element.lowercased()).inserted }
        let chosen = candidates.sorted { $0.element.count > $1.element.count || ($0.element.count == $1.element.count && $0.offset < $1.offset) }.prefix(count)
        return chosen.sorted { $0.offset < $1.offset }.map(\.element)
    }

    /// Splits text into word segments with blanks for each target (first occurrence, in order).
    public static func segmentize(_ text: String, targets: [String]) -> ([Segment], [String]) {
        var ranges: [(Range<String.Index>, String)] = []
        var searchFrom = text.startIndex
        for t in targets {
            let pattern = "\\b" + NSRegularExpression.escapedPattern(for: t) + "\\b"
            if let r = text.range(of: pattern, options: [.regularExpression, .caseInsensitive], range: searchFrom..<text.endIndex) {
                ranges.append((r, String(text[r]))); searchFrom = r.upperBound
            } else if let r = text.range(of: pattern, options: [.regularExpression, .caseInsensitive]), !ranges.contains(where: { $0.0.overlaps(r) }) {
                ranges.append((r, String(text[r])))
            }
        }
        ranges.sort { $0.0.lowerBound < $1.0.lowerBound }
        var segs: [Segment] = []
        var blanks: [String] = []
        var cursor = text.startIndex
        func pushText(_ s: Substring) {
            for w in s.split(whereSeparator: { $0.isWhitespace }) { segs.append(.text(String(w))) }
        }
        for (r, word) in ranges {
            pushText(text[cursor..<r.lowerBound])
            var suffixEnd = r.upperBound
            while suffixEnd < text.endIndex, !text[suffixEnd].isWhitespace { suffixEnd = text.index(after: suffixEnd) }
            segs.append(.blank(blanks.count, suffix: String(text[r.upperBound..<suffixEnd])))
            blanks.append(word)
            cursor = suffixEnd
        }
        pushText(text[cursor...])
        return (segs, blanks)
    }

    /// 3..5 chunks split at punctuation or about 6 words.
    public static func chunks(_ text: String) -> [String] {
        let ws = TextKit.words(text)
        guard ws.count >= 3 else { return ws }
        var parts: [[String]] = [[]]
        for w in ws {
            parts[parts.count - 1].append(w)
            if let l = w.last, ",;:.?!".contains(l) { parts.append([]) }
        }
        parts = parts.filter { !$0.isEmpty }
        var split: [[String]] = []
        for p in parts {
            if p.count > 7 {
                let n = Int((Double(p.count) / 6).rounded(.up))
                let size = Int((Double(p.count) / Double(n)).rounded(.up))
                var i = 0
                while i < p.count { split.append(Array(p[i..<min(p.count, i + size)])); i += size }
            } else { split.append(p) }
        }
        while split.count > 5 {
            // Merge the smallest adjacent pair.
            var best = 0, bestSize = Int.max
            for i in 0..<(split.count - 1) where split[i].count + split[i + 1].count < bestSize { best = i; bestSize = split[i].count + split[i + 1].count }
            split[best] += split[best + 1]; split.remove(at: best + 1)
        }
        if split.count < 3 {
            let n = 3
            let size = Int((Double(ws.count) / Double(n)).rounded(.up))
            split = stride(from: 0, to: ws.count, by: size).map { Array(ws[$0..<min(ws.count, $0 + size)]) }
        }
        return split.map { $0.joined(separator: " ") }
    }

    /// "A__ f___ c__ c________," style hint.
    public static func letterHint(_ text: String) -> String {
        TextKit.words(text).map { w in
            var out = ""
            var first = true
            for ch in w {
                if ch.isLetter || ch.isNumber {
                    out.append(first ? ch : "_"); first = false
                } else { out.append(ch) }
            }
            return out
        }.joined(separator: " ")
    }
}

// MARK: - Session state (re-queue mistakes, spec 5.2)

public struct SessionState {
    public private(set) var queue: [Exercise]
    public private(set) var index = 0
    public let total: Int
    public private(set) var correct = 0
    public private(set) var mistakes = 0
    public private(set) var combo = 0
    public private(set) var bestCombo = 0
    public private(set) var firstAttemptCorrect = 0
    public private(set) var applies = 0
    public private(set) var grades: [String: Grade] = [:]
    /// First attempt per exercise, for practice test scoring.
    public private(set) var log: [(cardIds: [String], passed: Bool)] = []
    /// Practice tests do not re-queue mistakes (spec 8.6).
    public let requeue: Bool

    public init(exercises: [Exercise], requeue: Bool = true) {
        queue = exercises
        total = exercises.count
        self.requeue = requeue
    }

    public var current: Exercise? { index < queue.count ? queue[index] : nil }
    public var isFinished: Bool { index >= queue.count }
    public var progress: Double { total == 0 ? 1 : Double(correct) / Double(total) }
    public var accuracy: Double { total == 0 ? 1 : Double(firstAttemptCorrect) / Double(total) }

    /// Records an answer for the current exercise. Returns grades for cards graded for the first time.
    @discardableResult
    public mutating func submit(_ result: CheckResult, seconds: Double = 10, flashGrade: Grade? = nil) -> [String: Grade] {
        guard let ex = current else { return [:] }
        if !ex.isRetry { log.append((ex.cardIds, result.passes)) }
        if result.passes {
            correct += 1
            combo += 1
            bestCombo = max(bestCombo, combo)
            if !ex.isRetry { firstAttemptCorrect += 1 }
            if ex.kind == .apply { applies += 1 }
        } else if !requeue {
            // Practice test: a miss still moves the test forward.
            correct += 1
            mistakes += 1
            combo = 0
        } else {
            mistakes += 1
            combo = 0
            var retry = ex
            retry.id = IDGen.make()
            retry.isRetry = true
            queue.append(retry)
        }
        var fresh: [String: Grade] = [:]
        let g = flashGrade ?? SRSEngine.grade(for: result, kind: ex.kind, seconds: seconds)
        for id in ex.cardIds where grades[id] == nil {
            grades[id] = g; fresh[id] = g
        }
        return fresh
    }

    public mutating func advance() { if index < queue.count { index += 1 } }

    public var xp: Int {
        ProgressEngine.sessionXP(correctFirstAttempts: firstAttemptCorrect, completed: isFinished, mistakes: mistakes, applies: applies)
    }
}

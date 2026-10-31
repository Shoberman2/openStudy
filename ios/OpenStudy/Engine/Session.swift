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
    public static func quoteMix(level: Int) -> [ExerciseKind] {
        switch level {
        case ...0: return [.qBank1]
        case 1: return [.qBank1, .qBank3]
        case 2: return [.qBank3, .qOrder]
        case 3: return [.qOrder, .qLetters]
        default: return [.qLetters, .qRecall]
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
        let length = sessionLength - nPictures
        let pool = (projectCards.isEmpty ? cards : projectCards).filter { !$0.isPicture }
        var picker = Picker(order: orderCards(own, now: now))
        var out = lesson.isQuotes
            ? quoteSession(&picker, lesson: lesson, pool: pool, length: length, rng: &rng)
            : lessonSession(&picker, lesson: lesson, own: own, pool: pool, isClass: isClass, profile: profile, length: length, rng: &rng)
        // Flashcards replace one slot when the user picked them (never the first).
        if !lesson.isQuotes, profile.practice.contains("flash"), out.count > 2 {
            let idx = min(3, out.count - 1)
            if out[idx].kind != .match && out[idx].kind != .apply, let c = own.first(where: { $0.id == out[idx].cardId }) {
                out[idx] = make(.flash, card: c, extraWords: [], rng: &rng)
            }
        }
        return insertPictures(out, Array(pictures.prefix(nPictures)), rng: &rng)
    }

    /// Cards in priority order, each used at most twice per session; unused cards come first.
    struct Picker {
        let order: [Card]
        var uses: [String: Int] = [:]
        init(order: [Card]) { self.order = order }
        func next(_ f: (Card) -> Bool = { _ in true }, unusedOnly: Bool = false) -> Card? {
            for round in 0..<(unusedOnly ? 1 : 2) {
                if let c = order.first(where: { (uses[$0.id] ?? 0) == round && f($0) }) { return c }
            }
            return nil
        }
        func unusedFirst(_ f: (Card) -> Bool) -> Card? { next(f) }
        func available(_ f: (Card) -> Bool) -> [Card] { order.filter { (uses[$0.id] ?? 0) < 2 && f($0) } }
        mutating func take(_ c: Card) { uses[c.id, default: 0] += 1 }
    }

    static func quoteSession<R: RandomNumberGenerator>(_ picker: inout Picker, lesson: Lesson, pool: [Card], length: Int, rng: inout R) -> [Exercise] {
        let mix = quoteMix(level: lesson.level)
        let extraWords = pool.flatMap { longWords($0.statement) }
        var out: [Exercise] = []
        while out.count < length, let card = picker.next() {
            var kind = mix.randomElement(using: &rng)!
            if kind == .qRecall && out.isEmpty { kind = .qLetters }
            out.append(make(kind, card: card, extraWords: extraWords, rng: &rng))
            picker.take(card)
        }
        return out
    }

    enum Slot: Equatable { case m, bank, type, tf, explain, apply, match }

    /// Which kind of question each slot asks (spec 13.8): multiple choice everywhere except slots 2, 4, 6
    /// and 8, which take two fill-ins and two others in a shuffled order.
    static func slotPlan<R: RandomNumberGenerator>(level: Int, length: Int, apply: Bool, match: Bool, rng: inout R) -> [Slot] {
        let lvl = min(4, max(0, level))
        let fills: [Slot] = lvl <= 1 ? [.bank, .bank] : lvl <= 3 ? [.bank, .type] : [.type, .bank]
        let others: [Slot] = lvl <= 1 ? [match ? .match : .tf, .tf] : [.tf, lvl >= 4 && apply ? .apply : .explain]
        let special = (fills + others).shuffled(using: &rng)
        var plan = [Slot](repeating: .m, count: length)
        for (i, at) in [2, 4, 6, 8].enumerated() where at < length { plan[at] = special[i] }
        return plan
    }

    /// Theme and class lessons (spec 13.8): a majority of multiple choice, two fill-ins and two others.
    static func lessonSession<R: RandomNumberGenerator>(_ picker: inout Picker, lesson: Lesson, own: [Card], pool: [Card], isClass: Bool, profile: Profile, length: Int, rng: inout R) -> [Exercise] {
        let defs = pool.filter(\.isDefinition)
        let ownDefs = own.filter(\.isDefinition)
        let extraWords = pool.flatMap { longWords($0.statement) }
        let blanks = KeyBlanks(pool: pool)
        let plan = slotPlan(level: lesson.level, length: length, apply: profile.goals.contains("apply"), match: isClass && ownDefs.count >= 4, rng: &rng)
        var out: [Exercise] = []
        var asked = Set<String>()
        // A card plays at most one fill-in per session, so the same blank never shows up twice.
        var filled = Set<String>()
        var mcSlots = 0
        var deepUsed = false
        let tfReady: (Card) -> Bool = { $0.isConcept && !($0.distractors ?? []).isEmpty }

        for slot in plan {
            switch slot {
            case .bank, .type:
                if let card = picker.unusedFirst({ blanks.word($0) != nil && !filled.contains($0.id) }) {
                    filled.insert(card.id)
                    let fc = blanks.withBlank(card)
                    let kind: ExerciseKind = slot == .type ? (card.isDefinition ? .termType : .type) : (card.isDefinition && lesson.level <= 1 ? .defMc : .bank)
                    picker.take(card); out.append(make(kind, card: fc, extraWords: extraWords, defs: defs, rng: &rng)); continue
                }
            case .tf:
                if let card = picker.unusedFirst(tfReady) {
                    picker.take(card); out.append(make(.tf, card: card, extraWords: extraWords, rng: &rng)); continue
                }
            case .match:
                var chosen: [Card] = []
                for c in picker.available(\.isDefinition) where chosen.count < 4 {
                    if !chosen.contains(where: { $0.term?.lowercased() == c.term?.lowercased() }) { chosen.append(c) }
                }
                if chosen.count == 4 { chosen.forEach { picker.take($0) }; out.append(makeMatch(chosen, rng: &rng)); continue }
            case .explain, .apply:
                if !deepUsed, !out.isEmpty {
                    let card = slot == .explain ? (picker.unusedFirst({ $0.isConcept || $0.isDefinition }) ?? picker.next()) : picker.unusedFirst({ !$0.isDefinition })
                    if let card {
                        deepUsed = true
                        var e = make(slot == .apply ? .apply : .explain, card: card, extraWords: extraWords, rng: &rng)
                        if e.kind == .explain {
                            let topic = explainTopic(card, lessonTitle: lesson.title, keyWord: blanks.word(card) == card.cloze ? card.cloze : nil)
                            e.hint = topic
                            e.body = "Explain \(topic) in your own words like you're teaching a friend."
                        }
                        picker.take(card); out.append(e); continue
                    }
                }
            case .m:
                break
            }
            // Multiple choice, or a slot above that could not be used.
            let k = mcSlots
            mcSlots += 1
            if isClass, !ownDefs.isEmpty, k % 2 == 0, let card = picker.next(\.isDefinition, unusedOnly: true) {
                picker.take(card); out.append(make(.defMc, card: card, extraWords: extraWords, defs: defs, rng: &rng)); continue
            }
            if let (card, e) = mixedMC(k: k, picker: picker, pool: pool, asked: &asked, extraWords: extraWords, defs: defs, rng: &rng) {
                picker.take(card); out.append(e); continue
            }
            // Nothing new to ask about an idea: a missing key word, then an idea question again, then any card.
            let fillable: (Card) -> Bool = { blanks.word($0) != nil && !filled.contains($0.id) }
            var again = Set<String>()
            if picker.available(fillable).isEmpty, let (card, e) = mixedMC(k: k, picker: picker, pool: pool, asked: &again, extraWords: extraWords, defs: defs, rng: &rng) {
                picker.take(card); out.append(e); continue
            }
            guard let card = picker.unusedFirst(fillable) ?? picker.next() else { break }
            picker.take(card)
            if card.isDefinition {
                out.append(make(k % 2 == 0 ? .defMc : .mc, card: card, extraWords: extraWords, defs: defs, rng: &rng)); continue
            }
            let fc = blanks.word(card) != nil && !card.isConcept ? blanks.withBlank(card) : card
            if blanks.word(card) != nil { filled.insert(card.id) }
            out.append(make(.mc, card: (fc.distractors ?? []).count >= 3 ? fc : card, extraWords: extraWords, defs: defs, rng: &rng))
        }
        return out
    }

    /// The idea an explain names (spec 13.8): a term, a concept that is more than the lesson title, the
    /// sentence itself when short, its key word, or the lesson title.
    static func explainTopic(_ c: Card, lessonTitle: String, keyWord: String?) -> String {
        if let t = c.term, !t.isEmpty { return t }
        if let concept = c.concept?.trimmingCharacters(in: .whitespaces), !concept.isEmpty, concept != lessonTitle { return concept }
        if spaceCount(c.statement) <= 20 {
            var t = c.statement
            while let l = t.last, l == "." || l.isWhitespace { t.removeLast() }
            return "\u{201C}\(t)\u{201D}"
        }
        if let k = keyWord, spaceCount(k) <= 3 { return k }
        return lessonTitle
    }

    // MARK: Whole-page questions (spec 13.7)

    public enum PageForm: String, CaseIterable {
        case gist, odd
        var prompt: String {
            switch self {
            case .gist: return "These lines come from one page. Which idea goes with them?"
            case .odd: return "Three of these belong together. Which one doesn't?"
            }
        }
    }

    static let mcForms = ["concept", "gist", "odd"]

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
    static func mixedMC<R: RandomNumberGenerator>(k: Int, picker: Picker, pool: [Card], asked: inout Set<String>,
                                                  extraWords: [String], defs: [Card], rng: inout R) -> (Card, Exercise)? {
        for unusedOnly in [true, false] {
            let cands = picker.order.filter { (picker.uses[$0.id] ?? 0) < (unusedOnly ? 1 : 2) }
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
                    let key = "\(name):\(c.pageId ?? "")"
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
    static func cardMC<R: RandomNumberGenerator>(_ c: Card, pool: [Card], index: Int, extraWords: [String], defs: [Card] = [], blanks: KeyBlanks? = nil, rng: inout R) -> Exercise {
        if c.isConcept {
            var e = make(.mc, card: c, extraWords: extraWords, defs: defs, rng: &rng)
            e.form = "concept"
            return e
        }
        for i in 0..<PageForm.allCases.count {
            if let e = pageMC(c, pool: pool, form: PageForm.allCases[(index + i) % PageForm.allCases.count], rng: &rng) { return e }
        }
        if let blanks, blanks.word(c) != nil, !c.isDefinition {
            let fc = blanks.withBlank(c)
            if (fc.distractors ?? []).count >= 3 { return make(.mc, card: fc, extraWords: extraWords, defs: defs, rng: &rng) }
        }
        return make(.mc, card: c, extraWords: extraWords, defs: defs, rng: &rng)
    }

    /// Everyday words that are never the point of a sentence, so they are never blanked.
    static let plainWords: Set<String> = Set("want wants wanted take takes make makes made feel feels seem seems part good best better big new way ways self life thing things people person time times every little great really need needs needed give gives get gets go goes come comes look looks know knows keep keeps start starts find finds help helps tell tells talk talks show shows long much many most more first last next same other others another instead about rather without within never always often".split(separator: " ").map(String.init))

    /// Key words for fill-ins (spec 13.8): a definition's term, or a word whose stem is on 2 or more fact
    /// cards of the pool but no more than 30% of them, 5+ letters, not an everyday word, said once in its sentence.
    public struct KeyBlanks {
        var cardsWith: [String: Int] = [:]
        var most = 2
        var keyWords: [(stem: String, word: String)] = []

        public init(pool: [Card]) {
            var facts = 0
            for c in pool where c.kind == "fact" {
                facts += 1
                for st in Set(TextKit.tokens(c.statement)) { cardsWith[st, default: 0] += 1 }
            }
            most = max(2, Int(Double(facts) * 0.3))
            var seen = Set<String>()
            for c in pool where c.kind == "fact" {
                for t in TextKit.surfaceTokens(c.statement) where isKey(t.stem, t.surface) && seen.insert(t.stem).inserted {
                    keyWords.append((t.stem, t.surface.lowercased()))
                }
            }
        }

        func isKey(_ stem: String?, _ surface: String) -> Bool {
            guard let stem else { return false }
            let n = cardsWith[stem] ?? 0
            return n >= 2 && n <= most && surface.count >= 5 && !SessionBuilder.plainWords.contains(surface.lowercased())
        }

        /// The card's own blank when it is a key word, else the statement's key word on the most cards (then the longest).
        public func word(_ c: Card) -> String? {
            if c.isDefinition { return c.term }
            guard c.kind == "fact" else { return nil }
            var own: [String: Int] = [:]
            for st in TextKit.tokens(c.statement) { own[st, default: 0] += 1 }
            let once: (String?) -> Bool = { st in st.map { own[$0] == 1 } ?? false }
            if let cz = c.cloze, !cz.isEmpty, LessonBuilder.containsTerm(c.statement, cz) {
                let st = TextKit.tokens(cz).first
                if isKey(st, cz) && once(st) { return cz }
            }
            var best: (word: String, n: Int)?
            for t in TextKit.surfaceTokens(c.statement) where isKey(t.stem, t.surface) && once(t.stem) && LessonBuilder.containsTerm(c.statement, t.surface) {
                let n = (cardsWith[t.stem] ?? 0) * 100 + t.surface.count
                if best == nil || n > best!.n { best = (t.surface, n) }
            }
            return best?.word
        }

        /// Other key words: never the same stem or a word already in the sentence; same shape, then closest length.
        public func wrong(_ c: Card, word: String, count: Int) -> [String] {
            let w = word.lowercased()
            let shape = LessonBuilder.shapeClass(w)
            let own = TextKit.tokens(w).first
            return keyWords.filter { $0.stem != own && !LessonBuilder.containsTerm(c.statement, $0.word) }.map(\.word)
                .sorted { a, b in
                    let sa = LessonBuilder.shapeClass(a) == shape, sb = LessonBuilder.shapeClass(b) == shape
                    if sa != sb { return sa }
                    let da = abs(a.count - w.count), db = abs(b.count - w.count)
                    return da != db ? da < db : a < b
                }
                .prefix(count).map { $0 }
        }

        /// The card with its blank on its key word, and wrong answers that are other key words of the same shape.
        public func withBlank(_ c: Card) -> Card {
            guard !c.isDefinition, let w = word(c) else { return c }
            let own = w == c.cloze ? (c.distractors ?? []).filter { TextKit.wordCount($0) == 1 && !LessonBuilder.containsTerm(c.statement, $0) } : []
            var picks: [String] = []
            for d in wrong(c, word: w, count: 3) + own where picks.count < 3 && !picks.contains(d) { picks.append(d) }
            var out = c
            out.cloze = w; out.question = nil; out.answer = nil; out.distractors = picks; out.falseStatement = nil
            return out
        }
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
        let factPool = cards.filter { !$0.isPicture }
        let blanks = KeyBlanks(pool: factPool)
        var out: [Exercise] = []
        for c in picked {
            if c.isQuote {
                out.append(make(Bool.random(using: &rng) ? .qBank3 : .qLetters, card: c, extraWords: extra, rng: &rng))
                continue
            }
            // Mostly multiple choice, some fill-ins on key words, a few true or false (spec 13.8).
            let r = out.isEmpty ? 0 : Double.random(in: 0..<1, using: &rng)
            if r >= 0.85, c.isConcept, !(c.distractors ?? []).isEmpty {
                out.append(make(.tf, card: c, extraWords: extra, rng: &rng))
            } else if r >= 0.65, blanks.word(c) != nil, !c.isDefinition {
                out.append(make(.bank, card: blanks.withBlank(c), extraWords: extra, rng: &rng))
            } else {
                out.append(cardMC(c, pool: factPool, index: out.count, extraWords: extra, blanks: blanks, rng: &rng))
            }
        }
        return insertPictures(out, Array(duePictures.prefix(nPictures)), rng: &rng)
    }

    public static func nextReview(_ cards: [Card]) -> Date? {
        cards.filter { $0.srs.state != "new" }.map(\.srs.dueDate).min()
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

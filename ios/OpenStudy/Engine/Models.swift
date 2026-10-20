import Foundation

// Library v1. Field names and value strings match shared/SPEC.md section 2 exactly so
// exported files are interchangeable with the web app.

public enum JSONValue: Codable, Equatable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        self = .string(try c.decode(String.self))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n):
            if n == n.rounded(), abs(n) < 1e15 { try c.encode(Int(n)) } else { try c.encode(n) }
        case .bool(let b): try c.encode(b)
        }
    }

    public var doubleValue: Double? { if case .number(let n) = self { return n }; return nil }
    public var boolValue: Bool? { if case .bool(let b) = self { return b }; return nil }
    public var stringValue: String? { if case .string(let s) = self { return s }; return nil }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
}

public struct Profile: Codable, Equatable {
    public var onboarded: Bool = false
    public var bringing: [String] = ["books"]        // v2: "books" | "class" | "anything"
    public var goals: [String] = ["ideas"]         // "ideas" | "facts" | "quotes" | "apply"
    public var practice: [String] = ["tap", "blank"] // "tap" | "blank" | "type" | "flash"
    public var dailyGoalXP: Int = 20               // 10 | 20 | 30 | 50
    public var reminder: String?                   // "HH:mm"
    /// Shown on the Profile screen (spec 11.3).
    public var name: String?

    public init() {}

    enum CodingKeys: String, CodingKey { case onboarded, bringing, goals, practice, dailyGoalXP, reminder, name }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        onboarded = try c.decodeIfPresent(Bool.self, forKey: .onboarded) ?? false
        // v1 stored a single string ("screenshots" | "notes" | "both"); v2 stores an array.
        if let arr = try? c.decodeIfPresent([String].self, forKey: .bringing) {
            bringing = arr
        } else if let old = try? c.decodeIfPresent(String.self, forKey: .bringing) {
            bringing = ["screenshots", "notes", "both"].contains(old) ? ["books"] : [old]
        } else { bringing = ["books"] }
        goals = try c.decodeIfPresent([String].self, forKey: .goals) ?? ["ideas"]
        practice = try c.decodeIfPresent([String].self, forKey: .practice) ?? ["tap", "blank"]
        dailyGoalXP = try c.decodeIfPresent(Int.self, forKey: .dailyGoalXP) ?? 20
        reminder = try c.decodeIfPresent(String.self, forKey: .reminder)
        name = try c.decodeIfPresent(String.self, forKey: .name)
    }
}

public struct Stats: Codable, Equatable {
    public var xp: Int = 0
    public var streak: Int = 0
    public var longestStreak: Int = 0
    public var lastActiveDay: String?
    public var freezes: Int = 0
    public var dayXP: [String: Int] = [:]

    public init() {}

    enum CodingKeys: String, CodingKey { case xp, streak, longestStreak, lastActiveDay, freezes, dayXP }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        xp = try c.decodeIfPresent(Int.self, forKey: .xp) ?? 0
        streak = try c.decodeIfPresent(Int.self, forKey: .streak) ?? 0
        longestStreak = try c.decodeIfPresent(Int.self, forKey: .longestStreak) ?? 0
        lastActiveDay = try c.decodeIfPresent(String.self, forKey: .lastActiveDay)
        freezes = try c.decodeIfPresent(Int.self, forKey: .freezes) ?? 0
        dayXP = try c.decodeIfPresent([String: Int].self, forKey: .dayXP) ?? [:]
    }
}

public enum ProjectColor: String, Codable, CaseIterable {
    case blue, red, yellow, green, ink
}

public struct Project: Codable, Identifiable, Equatable, Hashable {
    public var id: String
    public var title: String
    public var author: String?
    public var color: ProjectColor
    public var createdAt: String
    public var focus: String          // "ideas" | "ideas+quotes"
    public var quotesAsked: Bool
    public var sample: Bool?
    public var type: String?          // v2: "book" | "class" | "other" (nil = "book")
    public var goalDate: String?      // v2: "YYYY-MM-DD"
    public var minutesPerDay: Int?    // v2: plan override
    public var category: String?      // v3: subject shelf, e.g. "Biology" (spec 9.4)

    public var kind: String { type ?? "book" }
    public var isClass: Bool { kind == "class" }

    public init(id: String = IDGen.make(), title: String, author: String? = nil, color: ProjectColor, createdAt: String = ISO.now(), focus: String = "ideas", quotesAsked: Bool = false, sample: Bool? = nil, type: String? = nil, goalDate: String? = nil, minutesPerDay: Int? = nil, category: String? = nil) {
        self.id = id; self.title = title; self.author = author; self.color = color
        self.createdAt = createdAt; self.focus = focus; self.quotesAsked = quotesAsked; self.sample = sample
        self.type = type; self.goalDate = goalDate; self.minutesPerDay = minutesPerDay; self.category = category
    }

    enum CodingKeys: String, CodingKey { case id, title, author, color, createdAt, focus, quotesAsked, sample, type, goalDate, minutesPerDay, category }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? "Untitled"
        author = try c.decodeIfPresent(String.self, forKey: .author)
        color = (try? c.decodeIfPresent(ProjectColor.self, forKey: .color)) ?? .blue
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ISO.now()
        focus = try c.decodeIfPresent(String.self, forKey: .focus) ?? "ideas"
        quotesAsked = try c.decodeIfPresent(Bool.self, forKey: .quotesAsked) ?? false
        sample = try c.decodeIfPresent(Bool.self, forKey: .sample)
        type = try c.decodeIfPresent(String.self, forKey: .type)
        goalDate = try c.decodeIfPresent(String.self, forKey: .goalDate)
        minutesPerDay = try c.decodeIfPresent(Int.self, forKey: .minutesPerDay)
        category = try c.decodeIfPresent(String.self, forKey: .category)
    }
}

public struct Page: Codable, Identifiable, Equatable, Hashable {
    public var id: String
    public var projectId: String?
    public var kind: String           // "screenshot" | "note"
    public var text: String
    public var header: String?
    public var suggestedTitle: String?
    public var suggestedAuthor: String?
    public var image: String?
    public var assetId: String?
    public var createdAt: String
    public var sourceName: String?
    public var sourceIndex: Int?
    public var heading: String?
    public var verbatim: Bool?
    public var folder: String?        // v3: Apple Notes folder
    public var noteId: String?        // v3: Apple Notes id (or "sc:<hash>" from the Shortcut)
    public var words: [WordEntry]?    // v4: the page is a word list (spec 10.2)
    public var imageHash: String?     // v4: dHash of the image, 16 hex chars (spec 10.3)
    public var pageNumber: Int?       // v4: printed page number of a screenshot (spec 10.5)

    public init(id: String = IDGen.make(), projectId: String? = nil, kind: String, text: String, header: String? = nil, suggestedTitle: String? = nil, suggestedAuthor: String? = nil, image: String? = nil, assetId: String? = nil, createdAt: String = ISO.now(), sourceName: String? = nil, sourceIndex: Int? = nil, heading: String? = nil, verbatim: Bool? = nil, folder: String? = nil, noteId: String? = nil, words: [WordEntry]? = nil, imageHash: String? = nil, pageNumber: Int? = nil) {
        self.id = id; self.projectId = projectId; self.kind = kind; self.text = text; self.header = header
        self.suggestedTitle = suggestedTitle; self.suggestedAuthor = suggestedAuthor; self.image = image
        self.assetId = assetId; self.createdAt = createdAt
        self.sourceName = sourceName; self.sourceIndex = sourceIndex; self.heading = heading; self.verbatim = verbatim
        self.folder = folder; self.noteId = noteId
        self.words = words; self.imageHash = imageHash; self.pageNumber = pageNumber
    }

    enum CodingKeys: String, CodingKey { case id, projectId, kind, text, header, suggestedTitle, suggestedAuthor, image, assetId, createdAt, sourceName, sourceIndex, heading, verbatim, folder, noteId, words, imageHash, pageNumber }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        projectId = try c.decodeIfPresent(String.self, forKey: .projectId)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "note"
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        header = try c.decodeIfPresent(String.self, forKey: .header)
        suggestedTitle = try c.decodeIfPresent(String.self, forKey: .suggestedTitle)
        suggestedAuthor = try c.decodeIfPresent(String.self, forKey: .suggestedAuthor)
        image = try c.decodeIfPresent(String.self, forKey: .image)
        assetId = try c.decodeIfPresent(String.self, forKey: .assetId)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ISO.now()
        sourceName = try c.decodeIfPresent(String.self, forKey: .sourceName)
        sourceIndex = try c.decodeIfPresent(Int.self, forKey: .sourceIndex)
        heading = try c.decodeIfPresent(String.self, forKey: .heading)
        verbatim = try c.decodeIfPresent(Bool.self, forKey: .verbatim)
        folder = try c.decodeIfPresent(String.self, forKey: .folder)
        noteId = try c.decodeIfPresent(String.self, forKey: .noteId)
        words = try c.decodeIfPresent([WordEntry].self, forKey: .words)
        imageHash = try c.decodeIfPresent(String.self, forKey: .imageHash)
        pageNumber = try c.decodeIfPresent(Int.self, forKey: .pageNumber)
    }

    // projectId is `string | null` in the spec, so it is always written (null when unsorted).
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        if let projectId { try c.encode(projectId, forKey: .projectId) } else { try c.encodeNil(forKey: .projectId) }
        try c.encode(kind, forKey: .kind)
        try c.encode(text, forKey: .text)
        try c.encodeIfPresent(header, forKey: .header)
        try c.encodeIfPresent(suggestedTitle, forKey: .suggestedTitle)
        try c.encodeIfPresent(suggestedAuthor, forKey: .suggestedAuthor)
        try c.encodeIfPresent(image, forKey: .image)
        try c.encodeIfPresent(assetId, forKey: .assetId)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encodeIfPresent(sourceName, forKey: .sourceName)
        try c.encodeIfPresent(sourceIndex, forKey: .sourceIndex)
        try c.encodeIfPresent(heading, forKey: .heading)
        try c.encodeIfPresent(verbatim, forKey: .verbatim)
        try c.encodeIfPresent(folder, forKey: .folder)
        try c.encodeIfPresent(noteId, forKey: .noteId)
        try c.encodeIfPresent(words, forKey: .words)
        try c.encodeIfPresent(imageHash, forKey: .imageHash)
        try c.encodeIfPresent(pageNumber, forKey: .pageNumber)
    }
}

/// One entry of a word list (spec 10.2).
public struct WordEntry: Codable, Equatable, Hashable {
    public var term: String
    public var definition: String?
    public init(term: String, definition: String? = nil) { self.term = term; self.definition = definition }
}

public struct Lesson: Codable, Identifiable, Equatable, Hashable {
    public var id: String
    public var projectId: String
    public var title: String
    public var summary: String
    public var kind: String           // "theme" | "quotes"
    public var order: Int
    public var level: Int
    public var sessions: Int

    public var isQuotes: Bool { kind == "quotes" }

    public init(id: String = IDGen.make(), projectId: String, title: String, summary: String, kind: String = "theme", order: Int, level: Int = 0, sessions: Int = 0) {
        self.id = id; self.projectId = projectId; self.title = title; self.summary = summary
        self.kind = kind; self.order = order; self.level = level; self.sessions = sessions
    }
}

public struct Srs: Codable, Equatable, Hashable {
    public var state: String          // "new" | "learning" | "review"
    public var ease: Double
    public var interval: Int
    public var due: String
    public var reps: Int
    public var lapses: Int

    public static func fresh(now: Date = Date()) -> Srs {
        Srs(state: "new", ease: 2.5, interval: 0, due: ISO.string(now), reps: 0, lapses: 0)
    }

    public var dueDate: Date { ISO.date(due) ?? .distantPast }
}

public struct Card: Codable, Identifiable, Equatable, Hashable {
    public var id: String
    public var lessonId: String
    public var projectId: String
    public var pageId: String?
    public var kind: String           // "fact" | "quote" | "picture" (spec 11.2)
    public var statement: String
    public var cloze: String?
    public var question: String?
    public var answer: String?
    public var distractors: [String]?
    public var falseStatement: String?
    public var attribution: String?
    public var term: String?
    public var definition: String?
    public var srs: Srs

    public var isDefinition: Bool { !(term ?? "").isEmpty && !(definition ?? "").isEmpty }

    public var isQuote: Bool { kind == "quote" }
    public var isPicture: Bool { kind == "picture" }

    public init(id: String = IDGen.make(), lessonId: String, projectId: String, pageId: String? = nil, kind: String, statement: String, cloze: String? = nil, question: String? = nil, answer: String? = nil, distractors: [String]? = nil, falseStatement: String? = nil, attribution: String? = nil, term: String? = nil, definition: String? = nil, srs: Srs = .fresh()) {
        self.id = id; self.lessonId = lessonId; self.projectId = projectId; self.pageId = pageId
        self.kind = kind; self.statement = statement; self.cloze = cloze; self.question = question
        self.answer = answer; self.distractors = distractors; self.falseStatement = falseStatement
        self.attribution = attribution; self.srs = srs; self.term = term; self.definition = definition
    }

    enum CodingKeys: String, CodingKey { case id, lessonId, projectId, pageId, kind, statement, cloze, question, answer, distractors, falseStatement, attribution, term, definition, srs }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        lessonId = try c.decode(String.self, forKey: .lessonId)
        projectId = try c.decode(String.self, forKey: .projectId)
        pageId = try c.decodeIfPresent(String.self, forKey: .pageId)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "fact"
        statement = try c.decode(String.self, forKey: .statement)
        cloze = try c.decodeIfPresent(String.self, forKey: .cloze)
        question = try c.decodeIfPresent(String.self, forKey: .question)
        answer = try c.decodeIfPresent(String.self, forKey: .answer)
        distractors = try c.decodeIfPresent([String].self, forKey: .distractors)
        falseStatement = try c.decodeIfPresent(String.self, forKey: .falseStatement)
        attribution = try c.decodeIfPresent(String.self, forKey: .attribution)
        term = try c.decodeIfPresent(String.self, forKey: .term)
        definition = try c.decodeIfPresent(String.self, forKey: .definition)
        // Sample cards ship without srs: initialize on load.
        srs = try c.decodeIfPresent(Srs.self, forKey: .srs) ?? .fresh()
    }
}

public struct LibraryEvent: Codable, Equatable {
    public var t: String
    public var name: String
    public var props: [String: JSONValue]?

    public init(t: String = ISO.now(), name: String, props: [String: JSONValue]? = nil) {
        self.t = t; self.name = name; self.props = props
    }
}

public struct Library: Codable, Equatable {
    public var version: Int = 1
    public var profile = Profile()
    public var stats = Stats()
    public var projects: [Project] = []
    public var pages: [Page] = []
    public var lessons: [Lesson] = []
    public var cards: [Card] = []
    public var events: [LibraryEvent] = []

    public init() {}

    enum CodingKeys: String, CodingKey { case version, profile, stats, projects, pages, lessons, cards, events }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
        profile = try c.decodeIfPresent(Profile.self, forKey: .profile) ?? Profile()
        stats = try c.decodeIfPresent(Stats.self, forKey: .stats) ?? Stats()
        projects = try c.decodeIfPresent([Project].self, forKey: .projects) ?? []
        pages = try c.decodeIfPresent([Page].self, forKey: .pages) ?? []
        lessons = try c.decodeIfPresent([Lesson].self, forKey: .lessons) ?? []
        cards = try c.decodeIfPresent([Card].self, forKey: .cards) ?? []
        events = try c.decodeIfPresent([LibraryEvent].self, forKey: .events) ?? []
        backfillCategories()
    }

    /// Projects made before categories existed get one from their pages (spec 9.1).
    public mutating func backfillCategories() {
        guard projects.contains(where: { ($0.category ?? "").trimmingCharacters(in: .whitespaces).isEmpty }) else { return }
        var byProject: [String: [Page]] = [:]
        for p in pages { if let pid = p.projectId { byProject[pid, default: []].append(p) } }
        for i in projects.indices where (projects[i].category ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
            projects[i].category = Categories.categorize(title: projects[i].title, type: projects[i].kind, pages: byProject[projects[i].id] ?? [])
        }
    }

    public static func decode(_ data: Data) throws -> Library {
        try JSONDecoder().decode(Library.self, from: data)
    }

    public func encoded(pretty: Bool = false) throws -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = pretty ? [.prettyPrinted, .sortedKeys] : [.sortedKeys]
        return try enc.encode(self)
    }

    /// Export form: identical schema, but local image file names are dropped (spec: "Not exported").
    public func exportData() throws -> Data {
        var copy = self
        copy.pages = copy.pages.map { var p = $0; p.image = nil; return p }
        return try copy.encoded(pretty: true)
    }

    /// Merge another library in by id (spec 6.4 "Import library (merge by id)").
    /// Incoming records replace existing ones with the same id; profile and stats keep the better values.
    public mutating func merge(_ other: Library) {
        func mergeList<T: Identifiable>(_ a: inout [T], _ b: [T]) where T.ID == String {
            var index = Dictionary(uniqueKeysWithValues: a.enumerated().map { ($0.element.id, $0.offset) })
            for item in b {
                if let i = index[item.id] { a[i] = item } else { index[item.id] = a.count; a.append(item) }
            }
        }
        mergeList(&projects, other.projects)
        mergeList(&pages, other.pages)
        mergeList(&lessons, other.lessons)
        mergeList(&cards, other.cards)
        if other.profile.onboarded && !profile.onboarded { profile = other.profile }
        stats.xp = max(stats.xp, other.stats.xp)
        stats.longestStreak = max(stats.longestStreak, other.stats.longestStreak)
        if (other.stats.lastActiveDay ?? "") > (stats.lastActiveDay ?? "") {
            stats.lastActiveDay = other.stats.lastActiveDay
            stats.streak = other.stats.streak
        }
        stats.freezes = max(stats.freezes, other.stats.freezes)
        for (k, v) in other.stats.dayXP { stats.dayXP[k] = max(stats.dayXP[k] ?? 0, v) }
        let seen = Set(events.map { $0.t + $0.name })
        events.append(contentsOf: other.events.filter { !seen.contains($0.t + $0.name) })
        events.sort { $0.t < $1.t }
    }

    public func nextColor() -> ProjectColor {
        let all = ProjectColor.allCases
        return all[projects.count % all.count]
    }
}

public enum IDGen {
    static let alphabet = Array("0123456789abcdefghijklmnopqrstuvwxyz")
    public static func make() -> String {
        String((0..<10).map { _ in alphabet[Int.random(in: 0..<alphabet.count)] })
    }
}

public enum ISO {
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()
    public static func string(_ d: Date) -> String { fractional.string(from: d) }
    public static func now() -> String { string(Date()) }
    public static func date(_ s: String) -> Date? { fractional.date(from: s) ?? plain.date(from: s) }
}

public enum DayKey {
    /// "YYYY-MM-DD" in the given calendar's time zone (local by default).
    public static func of(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
    public static func date(_ key: String, calendar: Calendar = .current) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
    /// Whole days from a to b (b - a).
    public static func days(from a: String, to b: String, calendar: Calendar = .current) -> Int? {
        guard let da = date(a, calendar: calendar), let db = date(b, calendar: calendar) else { return nil }
        return calendar.dateComponents([.day], from: da, to: db).day
    }
}

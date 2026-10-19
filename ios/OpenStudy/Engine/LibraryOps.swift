import Foundation

/// Pure library mutations shared by the Store and tests.
public extension Library {
    var inbox: [Page] { pages.filter { $0.projectId == nil } }

    func project(_ id: String) -> Project? { projects.first { $0.id == id } }
    func lessons(of projectId: String) -> [Lesson] { lessons.filter { $0.projectId == projectId }.sorted { $0.order < $1.order } }
    func cards(of lessonId: String) -> [Card] { cards.filter { $0.lessonId == lessonId } }
    func cards(ofProject projectId: String) -> [Card] { cards.filter { $0.projectId == projectId } }
    func pages(of projectId: String) -> [Page] { pages.filter { $0.projectId == projectId }.sorted { $0.createdAt < $1.createdAt } }

    func dueCount(now: Date = Date()) -> Int { cards.filter { SessionBuilder.isDue($0, now: now) }.count }

    /// A theme lesson unlocks when the previous theme lesson has level >= 1. Quotes are always open.
    func isUnlocked(_ lesson: Lesson) -> Bool {
        if lesson.isQuotes { return true }
        let themes = lessons(of: lesson.projectId).filter { !$0.isQuotes }
        guard let i = themes.firstIndex(where: { $0.id == lesson.id }), i > 0 else { return true }
        return themes[i - 1].level >= 1
    }

    /// The lesson the path highlights: the one the plan picks next for this project, else the old rule.
    func currentLesson(of projectId: String, now: Date = Date()) -> Lesson? {
        if let l = PlanEngine.nextLesson(self, projectId: projectId, now: now) { return l }
        return fallbackCurrentLesson(of: projectId)
    }

    func fallbackCurrentLesson(of projectId: String) -> Lesson? {
        let ls = lessons(of: projectId)
        let themes = ls.filter { !$0.isQuotes && isUnlocked($0) }
        return themes.last(where: { $0.level == 0 }) ?? themes.first(where: { $0.level < 5 }) ?? ls.first(where: { $0.level < 5 }) ?? ls.first
    }

    /// Continue = the first not-done learning item in today's plan; the old rule only when today has none.
    func continueTarget(now: Date = Date()) -> (Project, Lesson)? {
        if let l = PlanEngine.nextLesson(self, todayOnly: true, now: now), let p = project(l.projectId) { return (p, l) }
        return fallbackContinueTarget()
    }

    /// Most recent project that has lessons (by last session activity, then creation).
    func fallbackContinueTarget() -> (Project, Lesson)? {
        var lastUse: [String: String] = [:]
        for e in events where e.name == "session_start" { if let p = e.props?["projectId"]?.stringValue { lastUse[p] = e.t } }
        let sorted = projects.filter { !lessons(of: $0.id).isEmpty }.sorted {
            (lastUse[$0.id] ?? $0.createdAt) > (lastUse[$1.id] ?? $1.createdAt)
        }
        for p in sorted { if let l = fallbackCurrentLesson(of: p.id) { return (p, l) } }
        return nil
    }

    mutating func log(_ name: String, _ props: [String: JSONValue]? = nil, now: Date = Date()) {
        events.append(LibraryEvent(t: ISO.string(now), name: name, props: props))
        if events.count > 5000 { events.removeFirst(events.count - 5000) }
    }

    /// Creates a project with lessons and cards from a build result. Quotes lesson goes after the first theme.
    @discardableResult
    mutating func createProject(title: String, author: String?, pageIds: [String], build: BuildResult, focus: String, quotes: [BuiltQuote]?, type: String = "book", goalDate: String? = nil, now: Date = Date()) -> Project {
        let project = Project(title: title, author: author?.isEmpty == true ? nil : author, color: nextColor(), createdAt: ISO.string(now), focus: focus, quotesAsked: true, type: type, goalDate: goalDate)
        projects.append(project)
        let ids = Set(pageIds)
        for i in pages.indices where ids.contains(pages[i].id) { pages[i].projectId = project.id }
        addLessons(to: project, build: build, quotes: quotes, now: now)
        return project
    }

    mutating func addLessons(to project: Project, build: BuildResult, quotes: [BuiltQuote]?, now: Date = Date()) {
        var order = (lessons(of: project.id).map(\.order).max() ?? -1) + 1
        var hasQuotes = lessons(of: project.id).contains { $0.isQuotes }
        let existing = Dictionary(lessons(of: project.id).map { ($0.title.lowercased(), $0) }, uniquingKeysWith: { a, _ in a })
        let knownStatements = Set(cards(ofProject: project.id).map { TextKit.normalizeKey($0.statement) })
        for (i, bl) in build.lessons.enumerated() {
            let lesson: Lesson
            if let ex = existing[bl.title.lowercased()], !ex.isQuotes { lesson = ex }
            else {
                lesson = Lesson(projectId: project.id, title: bl.title, summary: bl.summary, order: order)
                lessons.append(lesson); order += 1
            }
            for bc in bl.cards where !knownStatements.contains(TextKit.normalizeKey(bc.statement)) {
                cards.append(Card(lessonId: lesson.id, projectId: project.id, pageId: bc.pageId, kind: "fact", statement: bc.statement,
                                  cloze: bc.cloze, question: bc.question, answer: bc.answer, distractors: bc.distractors,
                                  falseStatement: bc.falseStatement, term: bc.term, definition: bc.definition, srs: .fresh(now: now)))
            }
            if i == 0, let qs = quotes, !qs.isEmpty, !hasQuotes {
                let ql = Lesson(projectId: project.id, title: "Quotes", summary: "The lines worth knowing word for word.", kind: "quotes", order: order)
                lessons.append(ql); order += 1; hasQuotes = true
                for q in qs { addQuote(q, to: project, now: now) }
            }
        }
        if build.lessons.isEmpty, let qs = quotes, !qs.isEmpty { for q in qs { addQuote(q, to: project, now: now) } }
    }

    /// Adds a quote card to the project's Quotes lesson, creating it (after the first theme) if needed.
    mutating func addQuote(_ q: BuiltQuote, to project: Project, now: Date = Date()) {
        let ql: Lesson
        if let existing = lessons(of: project.id).first(where: { $0.isQuotes }) { ql = existing }
        else {
            let firstOrder = lessons(of: project.id).first?.order ?? -1
            for i in lessons.indices where lessons[i].projectId == project.id && lessons[i].order > firstOrder { lessons[i].order += 1 }
            ql = Lesson(projectId: project.id, title: "Quotes", summary: "The lines worth knowing word for word.", kind: "quotes", order: firstOrder + 1)
            lessons.append(ql)
            if let pi = projects.firstIndex(where: { $0.id == project.id }) { projects[pi].focus = "ideas+quotes" }
        }
        let key = TextKit.normalizeKey(q.text)
        guard !cards(of: ql.id).contains(where: { TextKit.normalizeKey($0.statement) == key }) else { return }
        cards.append(Card(lessonId: ql.id, projectId: project.id, pageId: q.pageId, kind: "quote", statement: q.text,
                          attribution: q.attribution ?? project.author, srs: .fresh(now: now)))
    }

    mutating func movePages(_ ids: [String], to projectId: String?) {
        let set = Set(ids)
        for i in pages.indices where set.contains(pages[i].id) { pages[i].projectId = projectId }
        if projectId == nil { cards.removeAll { $0.pageId.map(set.contains) ?? false } }
    }

    mutating func deletePages(_ ids: [String]) {
        let set = Set(ids)
        pages.removeAll { set.contains($0.id) }
        cards.removeAll { $0.pageId.map(set.contains) ?? false }
    }

    mutating func deleteProject(_ id: String) {
        projects.removeAll { $0.id == id }
        let lessonIds = Set(lessons.filter { $0.projectId == id }.map(\.id))
        lessons.removeAll { $0.projectId == id }
        cards.removeAll { $0.projectId == id || lessonIds.contains($0.lessonId) }
        pages.removeAll { $0.projectId == id }
    }

    /// Loads the bundled sample projects (skips ones already present).
    mutating func addSample(_ sample: Library, now: Date = Date()) {
        let have = Set(projects.map(\.id))
        let fresh = sample.projects.filter { !have.contains($0.id) }
        let ids = Set(fresh.map(\.id))
        projects += fresh
        pages += sample.pages.filter { $0.projectId.map(ids.contains) ?? false }
        lessons += sample.lessons.filter { ids.contains($0.projectId) }
        cards += sample.cards.filter { ids.contains($0.projectId) }.map { var c = $0; c.srs = .fresh(now: now); return c }
        // The class sample gets an exam 10 days after first load (spec 8.7).
        for i in projects.indices where projects[i].id == "smpbio101" && ids.contains("smpbio101") {
            projects[i].goalDate = DayKey.of(Calendar.current.date(byAdding: .day, value: 10, to: now)!)
        }
    }

    /// Applies a finished session: SRS already applied per answer; this bumps level and sessions.
    mutating func finishLesson(_ lessonId: String) {
        guard let i = lessons.firstIndex(where: { $0.id == lessonId }) else { return }
        lessons[i].sessions += 1
        lessons[i].level = min(5, lessons[i].level + 1)
    }

    mutating func applyGrades(_ grades: [String: Grade], now: Date = Date()) {
        guard !grades.isEmpty else { return }
        for i in cards.indices { if let g = grades[cards[i].id] { cards[i].srs = SRSEngine.review(cards[i].srs, grade: g, now: now) } }
    }

    struct WeekStats: Equatable { public var daysActive: Int; public var activeDays: [Bool]; public var sessions: Int; public var accuracy: Double?; public var due: Int }

    func weekStats(now: Date = Date(), calendar: Calendar = .current) -> WeekStats {
        let keys = (0..<7).reversed().map { DayKey.of(calendar.date(byAdding: .day, value: -$0, to: now)!, calendar: calendar) }
        let active = keys.map { (stats.dayXP[$0] ?? 0) > 0 }
        let since = calendar.date(byAdding: .day, value: -7, to: now)!
        let done = events.filter { $0.name == "session_done" && (ISO.date($0.t) ?? .distantPast) >= since }
        let accs = done.compactMap { $0.props?["accuracy"]?.doubleValue }
        return WeekStats(daysActive: active.filter { $0 }.count, activeDays: active, sessions: done.count,
                         accuracy: accs.isEmpty ? nil : accs.reduce(0, +) / Double(accs.count), due: dueCount(now: now))
    }
}

/// Chooses the builder for a project's material: class builder for classes and file-based material, section 4 otherwise.
public enum LessonFactory {
    public static func build(pages: [Page], title: String?, author: String?, type: String) -> BuildResult {
        let fileBased = pages.contains { ["pdf", "slides", "doc", "photo"].contains($0.kind) || $0.sourceName != nil }
        if type == "class" || (type == "other" && fileBased) {
            return ClassBuilder.build(pages: pages, title: title, author: author)
        }
        return LessonBuilder.build(pages: pages, title: title, author: author)
    }
}

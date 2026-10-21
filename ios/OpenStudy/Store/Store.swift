import Foundation
import SwiftUI
import UIKit
import UserNotifications

enum Route: Hashable {
    case project(String)
    case sort
    case settings
    case plan
    case profile
}

struct SessionLaunch: Identifiable {
    let id = IDGen.make()
    var lessonId: String?          // nil = Practice (review) or a practice test
    var projectId: String?
    var exercises: [Exercise]
    var title: String
    var isTest = false
}

/// A paywall to show, and what the user was trying to do (spec 11.5 `paywall_view {from}`).
struct PaywallRequest: Identifiable, Equatable {
    let id = IDGen.make()
    var from: String
}

struct SessionSummary: Equatable {
    var xp: Int
    var accuracy: Double
    var seconds: Int
    var streak: Int
    var goalBefore: Double
    var goalAfter: Double
    var isPractice: Bool
    var perfect: Bool
    var test: TestResult?
    var projectId: String?
}

@MainActor
final class Store: ObservableObject {
    static let pendingExamKey = "pendingExamDate"
    @Published var library: Library { didSet { scheduleSave() } }
    @Published var path: [Route] = []
    @Published var session: SessionLaunch?
    @Published var showImport = false
    @Published var toast: String?
    @Published var paywall: PaywallRequest?
    /// The lesson title while a writer makes its concept questions (spec 13.6).
    @Published var writingFor: String?
    @AppStorage("smartServer") var smartServer: String = ""
    @Published var smartOn = false

    let fileURL: URL
    let imagesURL: URL
    private var saveTask: Task<Void, Never>?
    private let persist: Bool

    lazy var sample: Library = {
        guard let url = Bundle.main.url(forResource: "sample-library", withExtension: "json"),
              let data = try? Data(contentsOf: url), let lib = try? Library.decode(data) else { return Library() }
        return lib
    }()

    init(persist: Bool = true) {
        self.persist = persist
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent("OpenStudy", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir.appendingPathComponent("images"), withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("library.json")
        imagesURL = dir.appendingPathComponent("images", isDirectory: true)
        if persist, let data = try? Data(contentsOf: fileURL), let lib = try? Library.decode(data) {
            library = lib
        } else {
            library = Library()
        }
    }

    // MARK: Persistence (debounced atomic writes)

    private func scheduleSave() {
        guard persist else { return }
        saveTask?.cancel()
        let lib = library
        let url = fileURL
        saveTask = Task.detached(priority: .utility) {
            try? await Task.sleep(nanoseconds: 600_000_000)
            guard !Task.isCancelled else { return }
            if let data = try? lib.encoded() { try? data.write(to: url, options: .atomic) }
        }
    }

    func saveNow() {
        guard persist, let data = try? library.encoded() else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    // MARK: Images

    func saveImage(_ image: UIImage, id: String) -> String? {
        let scaled = image.scaledDown(maxSide: 900)
        guard let data = scaled.jpegData(compressionQuality: 0.72) else { return nil }
        let name = id + ".jpg"
        do { try data.write(to: imagesURL.appendingPathComponent(name), options: .atomic); return name } catch { return nil }
    }

    func image(for page: Page) -> UIImage? {
        guard let name = page.image else { return nil }
        return UIImage(contentsOfFile: imagesURL.appendingPathComponent(name).path)
    }

    // MARK: Photos sweep memory (device only, never exported; spec 9.1)

    var scannedURL: URL { fileURL.deletingLastPathComponent().appendingPathComponent("scanned-assets.json") }

    func loadScannedAssetIds() -> Set<String> {
        guard persist, let data = try? Data(contentsOf: scannedURL), let ids = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return Set(ids)
    }

    func saveScannedAssetIds(_ ids: Set<String>) {
        guard persist, let data = try? JSONEncoder().encode(ids.sorted()) else { return }
        try? data.write(to: scannedURL, options: .atomic)
    }

    // MARK: Derived

    var now: Date { Date() }
    var streak: Int { ProgressEngine.displayStreak(library.stats) }
    var goal: Double { ProgressEngine.goalProgress(library) }
    var dueCount: Int { library.dueCount() }
    var inboxCount: Int { library.inbox.count }
    var knownAssetIds: Set<String> { Set(library.pages.compactMap(\.assetId)) }

    func project(_ id: String?) -> Project? { id.flatMap { library.project($0) } }

    // MARK: Onboarding

    func finishOnboarding(_ profile: Profile) {
        var p = profile
        p.onboarded = true
        library.profile = p
        library.log("onboarding_done", ["goal": .number(Double(p.dailyGoalXP)), "practice": .string(p.practice.joined(separator: ","))])
    }

    func addSample() {
        library.addSample(sample)
    }

    // MARK: Import

    /// Adds imported pages, dropping duplicates of library pages or of each other (spec 10.3). Returns how many were added.
    @discardableResult
    func addPages(_ pages: [Page], kind: String, skipped: Int) -> Int {
        guard !pages.isEmpty || skipped > 0 else { return 0 }
        var index = DuplicateIndex(library.pages)
        let r = index.filter(pages)
        library.pages.append(contentsOf: r.kept)
        library.log("import", ["kind": .string(kind), "count": .number(Double(r.kept.count)), "skipped": .number(Double(skipped)), "duplicates": .number(Double(r.duplicates))])
        return r.kept.count
    }

    func discardPages(_ ids: [String]) {
        for p in library.pages where ids.contains(p.id) {
            if let img = p.image { try? FileManager.default.removeItem(at: imagesURL.appendingPathComponent(img)) }
        }
        library.deletePages(ids)
    }

    @discardableResult
    func createProject(title: String, author: String?, pageIds: [String], build: BuildResult, focus: String, quotes: [BuiltQuote]?, asked: Bool, type: String = "book", category: String? = nil) -> Project {
        var goal: String?
        if type == "class", !library.projects.contains(where: { $0.isClass && $0.sample != true }),
           let pending = UserDefaults.standard.string(forKey: Self.pendingExamKey) {
            goal = pending
            UserDefaults.standard.removeObject(forKey: Self.pendingExamKey)
        }
        let p = library.createProject(title: title, author: author, pageIds: pageIds, build: build, focus: focus, quotes: quotes, type: type, goalDate: goal, category: category)
        library.log("project_created", ["type": .string(type), "category": .string(p.category ?? category ?? "General"),
                                        "pages": .number(Double(pageIds.count)), "lessons": .number(Double(library.lessons(of: p.id).count))])
        if asked { library.log("quotes_answer", ["yes": .bool(!(quotes ?? []).isEmpty)]) }
        return p
    }

    /// Adds pages to an existing project and builds lessons for the new material.
    func addPages(_ pageIds: [String], toProject projectId: String) {
        guard let project = library.project(projectId) else { return }
        let ids = Set(pageIds)
        library.cards.removeAll { c in c.pageId.map(ids.contains) ?? false }
        library.movePages(pageIds, to: projectId)
        let pages = library.pages.filter { pageIds.contains($0.id) }
        let built = LessonFactory.build(pages: pages, title: project.title, author: project.author, type: project.kind)
        let hasQuotes = library.lessons(of: projectId).contains { $0.isQuotes }
        library.addLessons(to: project, build: built, quotes: hasQuotes ? built.quotes : nil)
        if hasQuotes { for q in built.quotes { library.addQuote(q, to: project) } }
    }

    /// Lessons for a group: smart build when available, else offline.
    func buildLessons(title: String, author: String?, type: String, pageIds: [String]) async -> BuildResult {
        let ids = Set(pageIds)
        await defineWordsSmart(pageIds: ids)
        let pages = library.pages.filter { ids.contains($0.id) }
        // Word lists always build offline (definition cards); smart build is for the rest (spec 10.2).
        let wordPages = pages.filter { !($0.words ?? []).isEmpty }
        let other = pages.filter { ($0.words ?? []).isEmpty }
        if !other.isEmpty, let client = smartClient, smartOn,
           let r = await client.build(title: title, author: author, type: type, pages: other, profile: library.profile, wantQuotes: true) {
            let smart = PictureCards.attach(r, pages: PageNumbers.ordered(other))
            return BuildResult(lessons: WordList.lessons(PageNumbers.ordered(wordPages)) + smart.lessons, quotes: smart.quotes)
        }
        return await Task.detached { LessonFactory.build(pages: pages, title: title, author: author, type: type) }.value
    }

    /// Smart organize fills in word-list definitions before a build (spec 10.2). Offline: nothing happens.
    func defineWordsSmart(pageIds: Set<String>) async {
        guard smartOn, let client = smartClient else { return }
        var seen = Set<String>()
        let missing = library.pages.filter { pageIds.contains($0.id) }.flatMap { $0.words ?? [] }
            .filter { ($0.definition ?? "").isEmpty && seen.insert($0.term.lowercased()).inserted }.map(\.term)
        guard !missing.isEmpty, let defs = await client.define(missing) else { return }
        let n = library.applyDefinitions(defs, pageIds: pageIds)
        if n > 0 { library.log("word_defined", ["source": "smart", "count": .number(Double(n))]) }
    }

    /// "Words to define" on the project screen.
    func defineWord(pageId: String, term: String, definition: String) {
        guard !definition.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        library.defineWord(pageId: pageId, term: term, definition: definition)
        library.log("word_defined", ["source": "user"])
    }

    /// The project a Sort group should extend: same book by 10.4 (title match, authors that agree).
    func matchingProject(title: String, author: String?) -> Project? {
        let t = title.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, t != Grouper.unsorted else { return nil }
        return library.projects.first { $0.title.lowercased() == t.lowercased() }
            ?? library.projects.first { Identity.sameWork(title: $0.title, author: $0.author, title: t, author: author) }
    }

    static let looseNotes = "Loose notes"

    /// Groups "Create all" builds: not Unsorted, not Loose notes (those stay on Sort for you to decide).
    static func bulkGroups(_ groups: [SuggestedGroup]) -> [SuggestedGroup] {
        groups.filter { $0.title != Grouper.unsorted && $0.title != looseNotes && !$0.title.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    /// "Create all" on Sort (spec 9.6): every group but Unsorted and Loose notes, one at a time, no per-project questions.
    /// Books with >= 3 quote candidates get a Quotes lesson. A title that matches a project extends it.
    func organizeAll(_ groups: [SuggestedGroup], progress: (Int, String) -> Void) async {
        let todo = Self.bulkGroups(groups)
        var created = 0
        var pages = 0
        var categories = Set<String>()
        for (i, g) in todo.enumerated() {
            let title = g.title.trimmingCharacters(in: .whitespaces)
            progress(i + 1, title)
            let ids = g.pageIds.filter { id in library.pages.contains { $0.id == id && $0.projectId == nil } }
            guard !ids.isEmpty else { continue }
            pages += ids.count
            if let match = matchingProject(title: title, author: g.author) {
                addPages(ids, toProject: match.id)
                if let c = match.category { categories.insert(c) }
                continue
            }
            let built = await buildLessons(title: title, author: g.author, type: g.type, pageIds: ids)
            let quotes = g.type == "book" && built.quotes.count >= 3 ? built.quotes : nil
            let p = createProject(title: title, author: g.author, pageIds: ids, build: built, focus: quotes == nil ? "ideas" : "ideas+quotes",
                                  quotes: quotes, asked: false, type: g.type, category: g.category)
            if let c = p.category { categories.insert(c) }
            created += 1
        }
        library.log("organize_all", ["projects": .number(Double(created)), "pages": .number(Double(pages)),
                                     "categories": .number(Double(categories.count)), "smart": .bool(smartOn)])
    }

    /// Edits after creation are logged: they tell us whether automatic organizing was right (spec 9.6).
    func renameProject(_ id: String, to title: String) {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, let i = library.projects.firstIndex(where: { $0.id == id }), library.projects[i].title != t else { return }
        library.projects[i].title = t
        library.log("project_renamed", ["projectId": .string(id)])
    }

    /// Choose a focus (spec 13.5). An empty list means everything.
    func setFocus(_ projectId: String, lessonIds: [String]) {
        library.setFocus(projectId: projectId, lessonIds: lessonIds)
    }

    func setCategory(_ id: String, to category: String) {
        let c = category.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !c.isEmpty, let i = library.projects.firstIndex(where: { $0.id == id }), library.projects[i].category != c else { return }
        library.projects[i].category = c
        library.log("category_changed", ["category": .string(c)])
    }

    /// Category names on the shelf, then the built-in ones, for suggestions.
    var categorySuggestions: [String] {
        var seen = Set<String>()
        return (library.projects.compactMap(\.category).sorted() + Categories.names).filter { seen.insert($0.lowercased()).inserted }
    }

    func markQuote(_ text: String, page: Page) {
        guard let pid = page.projectId, let project = library.project(pid) else { return }
        library.addQuote(BuiltQuote(pageId: page.id, text: text, attribution: project.author), to: project)
        toast = "Added to Quotes"
    }

    func movePage(_ id: String, to projectId: String?) { library.movePages([id], to: projectId) }

    // MARK: OpenStudy Plus (spec 11.5)

    /// True when the action may go ahead. Otherwise shows the paywall and returns false. Sample
    /// projects, importing and sorting stay free.
    func plusAllowed(sample: Bool = false, from: String) -> Bool {
        if sample || !AccountController.shared.state.needsPlus { return true }
        paywall = PaywallRequest(from: from)
        return false
    }

    private func isSample(_ projectId: String?) -> Bool { projectId.flatMap { library.project($0)?.sample } ?? false }
    private var hasOwnProjects: Bool { library.projects.contains { $0.sample != true } }

    // MARK: Sessions

    func start(lesson: Lesson) {
        guard plusAllowed(sample: isSample(lesson.projectId), from: "lesson") else { return }
        guard writingFor == nil else { return }
        guard WrittenConcepts.needsWrittenConcepts(library, lessonId: lesson.id) else { return begin(lesson) }
        // The first time a lesson opens, a writer turns its cards into concept questions (spec 13.6).
        let project = library.project(lesson.projectId)
        let input = QuestionWriter.Input(lessonTitle: lesson.title, projectTitle: project?.title ?? "", projectType: project?.kind ?? "book",
                                         cards: WrittenConcepts.writerInput(library, lessonId: lesson.id))
        let server = smartOn ? smartClient : nil
        writingFor = lesson.title
        Task {
            let result = await QuestionWriter.write(input, server: server)
            library = WrittenConcepts.applyWrittenConcepts(library, lessonId: lesson.id, written: result.cards, source: result.source)
            writingFor = nil
            begin(library.lessons.first { $0.id == lesson.id } ?? lesson)
        }
    }

    private func begin(_ lesson: Lesson) {
        var rng = SystemRandomNumberGenerator()
        let isClass = SessionBuilder.usesClassMix(projectIsClass: library.project(lesson.projectId)?.isClass ?? false, cards: library.cards(of: lesson.id))
        let ex = SessionBuilder.build(lesson: lesson, cards: library.cards(of: lesson.id), projectCards: library.cards(ofProject: lesson.projectId), profile: library.profile, isClass: isClass, rng: &rng)
        guard !ex.isEmpty else { toast = "This lesson has no cards yet"; return }
        library.log("session_start", ["lessonKind": .string(lesson.kind), "level": .number(Double(lesson.level)), "projectId": .string(lesson.projectId),
                                      "concepts": .number(Double(SessionBuilder.conceptCount(ex, cards: library.cards(of: lesson.id))))])
        session = SessionLaunch(lessonId: lesson.id, projectId: lesson.projectId, exercises: ex, title: lesson.title)
    }

    func startPractice() -> Bool {
        guard plusAllowed(sample: !hasOwnProjects, from: "practice") else { return true }
        var rng = SystemRandomNumberGenerator()
        let ex = SessionBuilder.practice(cards: library.cards, profile: library.profile, rng: &rng)
        guard !ex.isEmpty else { return false }
        library.log("session_start", ["lessonKind": .string("review"), "level": .number(0), "concepts": .number(Double(SessionBuilder.conceptCount(ex, cards: library.cards)))])
        session = SessionLaunch(lessonId: nil, projectId: nil, exercises: ex, title: "Practice")
        return true
    }

    /// "Practice both" on a connection (spec 10.8).
    func startConnection(_ c: Connection) {
        guard c.lessons.count == 2 else { return }
        guard plusAllowed(sample: c.projects.allSatisfy { isSample($0) }, from: "connection") else { return }
        var rng = SystemRandomNumberGenerator()
        let ex = SessionBuilder.connection(library.cards(of: c.lessons[0]), library.cards(of: c.lessons[1]), profile: library.profile, rng: &rng)
        guard !ex.isEmpty else { return }
        library.log("connection_practice", [:])
        let names = c.projects.compactMap { library.project($0)?.title }
        session = SessionLaunch(lessonId: nil, projectId: nil, exercises: ex, title: names.joined(separator: " + "))
    }

    // MARK: Ask your notes (spec 10.7)

    struct AskOutcome: Equatable {
        enum Kind: Equatable { case answer, local, fallback, nothing }
        var kind: Kind
        var answer: String = ""
        var quotes: [AskQuote] = []
    }

    /// Pages a question searches: one project, or every project (sample projects only when they are all there is).
    func askPages(projectId: String?) -> [Page] {
        if let projectId { return library.pages(of: projectId) }
        let ids = Library.scopeProjects(library.projects)
        return library.pages.filter { $0.projectId.map(ids.contains) ?? false }
    }

    /// "Atomic Habits, p. 12" or "Atomic Habits, Week 3 notes".
    func sourceLabel(_ pageId: String) -> String {
        guard let p = library.pages.first(where: { $0.id == pageId }) else { return "" }
        let project = p.projectId.flatMap { library.project($0)?.title } ?? "Your notes"
        if let n = p.pageNumber { return "\(project), p. \(n)" }
        if let s = p.sourceName ?? p.heading, !s.isEmpty, s.lowercased() != project.lowercased() { return "\(project), \(s)" }
        return project
    }

    func ask(_ question: String, projectId: String?) async -> AskOutcome {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return AskOutcome(kind: .nothing) }
        let pages = askPages(projectId: projectId)
        let local = AskEngine.localAnswer(q, pages: pages)
        var outcome = AskOutcome(kind: local.isEmpty ? .nothing : .local, quotes: local)
        var grounded = false
        if smartOn, let client = smartClient {
            let top = AskEngine.retrieve(q, pages: pages).map { (page: $0.page, title: sourceLabel($0.page.id)) }
            if !top.isEmpty {
                if let r = await client.ask(q, pages: top), r.grounded {
                    outcome = AskOutcome(kind: .answer, answer: r.answer, quotes: r.citations)
                    grounded = true
                } else if !local.isEmpty { outcome.kind = .fallback }
            }
        }
        library.log("ask", ["scope": .string(projectId == nil ? "all" : "project"), "smart": .bool(smartOn), "grounded": .bool(grounded)])
        return outcome
    }

    // MARK: Practice tests and plans

    func readyLessons(_ projectId: String) -> Int { library.lessons(of: projectId).filter { $0.level >= PlanEngine.readyLevel }.count }

    func startTest(projectId: String) {
        guard let p = library.project(projectId) else { return }
        guard plusAllowed(sample: p.sample == true, from: "test") else { return }
        var rng = SystemRandomNumberGenerator()
        let ex = PracticeTest.build(project: p, lib: library, rng: &rng)
        guard !ex.isEmpty else { toast = "Add lessons before taking a test"; return }
        library.log("session_start", ["lessonKind": "test", "level": 0, "projectId": .string(projectId),
                                      "concepts": .number(Double(SessionBuilder.conceptCount(ex, cards: library.cards(ofProject: projectId))))])
        session = SessionLaunch(lessonId: nil, projectId: projectId, exercises: ex, title: "Practice test", isTest: true)
    }

    /// "Review your misses": a normal session from the cards missed in a test.
    func startMisses(_ cardIds: [String], projectId: String?) {
        let cards = library.cards.filter { cardIds.contains($0.id) }
        guard !cards.isEmpty else { return }
        var rng = SystemRandomNumberGenerator()
        let defs = library.cards.filter(\.isDefinition)
        let extra = cards.flatMap { SessionBuilder.longWords($0.statement) }
        let ex = cards.enumerated().map { i, c -> Exercise in
            let kind: ExerciseKind = c.isQuote ? .qBank3 : c.isDefinition ? (i % 2 == 0 ? .defMc : .termType) : (i % 2 == 0 ? .mc : .bank)
            return SessionBuilder.make(kind, card: c, extraWords: extra, defs: defs, rng: &rng)
        }
        session = SessionLaunch(lessonId: nil, projectId: projectId, exercises: ex, title: "Review your misses")
    }

    var plan: StudyPlan { PlanEngine.build(library) }

    func startPlanItem(_ item: PlanItem) {
        switch item.kind {
        case .review: if !startPractice() { toast = nextReviewText }
        case .test: if let p = item.projectId { startTest(projectId: p) }
        case .lesson: if let l = library.lessons.first(where: { $0.id == item.lessonId }) { start(lesson: l) }
        }
    }

    var nextReviewText: String {
        guard let d = SessionBuilder.nextReview(library.cards) else { return "Nothing due. Finish a lesson and reviews will show up here." }
        let f = RelativeDateTimeFormatter(); f.unitsStyle = .full
        return "Nothing due. Your next review is \(f.localizedString(for: d, relativeTo: Date()))."
    }

    func grade(_ grades: [String: Grade]) { library.applyGrades(grades) }

    func finish(_ launch: SessionLaunch, state: SessionState, seconds: Int) -> SessionSummary {
        let before = goal
        var lib = library
        let xp = state.xp
        ProgressEngine.award(xp, to: &lib.stats)
        if let lid = launch.lessonId { lib.finishLesson(lid) }
        var props: [String: JSONValue] = ["accuracy": .number((state.accuracy * 100).rounded() / 100), "seconds": .number(Double(seconds)), "xp": .number(Double(xp))]
        if let lid = launch.lessonId { props["lessonId"] = .string(lid) }
        if let pid = launch.projectId { props["projectId"] = .string(pid) }
        lib.log("session_done", props)
        var test: TestResult?
        if launch.isTest, let pid = launch.projectId {
            let r = PracticeTest.score(log: state.log, lib: lib, projectId: pid)
            test = r
            lib.log("test_done", ["projectId": .string(pid), "accuracy": .number((r.accuracy * 100).rounded() / 100), "weakLessons": .string(r.weakLessons.joined(separator: ","))])
        } else if launch.lessonId == nil && launch.title == "Practice" {
            lib.log("review_done", ["count": .number(Double(state.total))])
        }
        library = lib
        return SessionSummary(xp: xp, accuracy: test?.accuracy ?? state.accuracy, seconds: seconds, streak: streak, goalBefore: before, goalAfter: goal,
                              isPractice: launch.lessonId == nil, perfect: state.mistakes == 0, test: test, projectId: launch.projectId)
    }

    // MARK: Library file

    func exportFile() -> URL? {
        guard let data = try? library.exportData() else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("openstudy-library-\(DayKey.of(Date())).json")
        do { try data.write(to: url, options: .atomic); return url } catch { return nil }
    }

    func importLibrary(from url: URL) -> Bool {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url), let other = try? Library.decode(data) else { return false }
        var lib = library
        lib.merge(other)
        if other.profile.onboarded { lib.profile.onboarded = true }
        library = lib
        return true
    }

    func reset() {
        try? FileManager.default.removeItem(at: imagesURL)
        try? FileManager.default.createDirectory(at: imagesURL, withIntermediateDirectories: true)
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        path = []
        library = Library()
        saveNow()
    }

    // MARK: Smart organize

    var smartClient: SmartOrganizeClient? { SmartOrganizeClient(base: smartServer) }

    func refreshSmartStatus() async {
        guard let c = smartClient else { smartOn = false; return }
        smartOn = await c.health()
    }
}

extension UIImage {
    func scaledDown(maxSide: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxSide else { return self }
        let scale = maxSide / longest
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}

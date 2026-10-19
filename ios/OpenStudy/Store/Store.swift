import Foundation
import SwiftUI
import UIKit
import UserNotifications

enum Route: Hashable {
    case project(String)
    case sort
    case settings
    case plan
}

struct SessionLaunch: Identifiable {
    let id = IDGen.make()
    var lessonId: String?          // nil = Practice (review) or a practice test
    var projectId: String?
    var exercises: [Exercise]
    var title: String
    var isTest = false
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

    func addPages(_ pages: [Page], kind: String, skipped: Int) {
        guard !pages.isEmpty || skipped > 0 else { return }
        library.pages.append(contentsOf: pages)
        library.log("import", ["kind": .string(kind), "count": .number(Double(pages.count)), "skipped": .number(Double(skipped))])
    }

    func discardPages(_ ids: [String]) {
        for p in library.pages where ids.contains(p.id) {
            if let img = p.image { try? FileManager.default.removeItem(at: imagesURL.appendingPathComponent(img)) }
        }
        library.deletePages(ids)
    }

    @discardableResult
    func createProject(title: String, author: String?, pageIds: [String], build: BuildResult, focus: String, quotes: [BuiltQuote]?, asked: Bool, type: String = "book") -> Project {
        var goal: String?
        if type == "class", !library.projects.contains(where: { $0.isClass && $0.sample != true }),
           let pending = UserDefaults.standard.string(forKey: Self.pendingExamKey) {
            goal = pending
            UserDefaults.standard.removeObject(forKey: Self.pendingExamKey)
        }
        let p = library.createProject(title: title, author: author, pageIds: pageIds, build: build, focus: focus, quotes: quotes, type: type, goalDate: goal)
        library.log("project_created", ["pages": .number(Double(pageIds.count)), "lessons": .number(Double(library.lessons(of: p.id).count))])
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

    func markQuote(_ text: String, page: Page) {
        guard let pid = page.projectId, let project = library.project(pid) else { return }
        library.addQuote(BuiltQuote(pageId: page.id, text: text, attribution: project.author), to: project)
        toast = "Added to Quotes"
    }

    func movePage(_ id: String, to projectId: String?) { library.movePages([id], to: projectId) }

    // MARK: Sessions

    func start(lesson: Lesson) {
        var rng = SystemRandomNumberGenerator()
        let isClass = library.project(lesson.projectId)?.isClass ?? false
        let ex = SessionBuilder.build(lesson: lesson, cards: library.cards(of: lesson.id), projectCards: library.cards(ofProject: lesson.projectId), profile: library.profile, isClass: isClass, rng: &rng)
        guard !ex.isEmpty else { toast = "This lesson has no cards yet"; return }
        library.log("session_start", ["lessonKind": .string(lesson.kind), "level": .number(Double(lesson.level)), "projectId": .string(lesson.projectId)])
        session = SessionLaunch(lessonId: lesson.id, projectId: lesson.projectId, exercises: ex, title: lesson.title)
    }

    func startPractice() -> Bool {
        var rng = SystemRandomNumberGenerator()
        let ex = SessionBuilder.practice(cards: library.cards, profile: library.profile, rng: &rng)
        guard !ex.isEmpty else { return false }
        library.log("session_start", ["lessonKind": .string("review"), "level": .number(0)])
        session = SessionLaunch(lessonId: nil, projectId: nil, exercises: ex, title: "Practice")
        return true
    }

    // MARK: Practice tests and plans

    func readyLessons(_ projectId: String) -> Int { library.lessons(of: projectId).filter { $0.level >= PlanEngine.readyLevel }.count }

    func startTest(projectId: String) {
        guard let p = library.project(projectId) else { return }
        var rng = SystemRandomNumberGenerator()
        let ex = PracticeTest.build(project: p, lib: library, rng: &rng)
        guard !ex.isEmpty else { toast = "Add lessons before taking a test"; return }
        library.log("session_start", ["lessonKind": "test", "level": 0, "projectId": .string(projectId)])
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

#if DEBUG
import SwiftUI
import UIKit

/// DEBUG-only launch arguments to exercise screens without tapping:
///   -demo                 sample library, onboarding done, some progress (in memory, not persisted)
///   -screen home|path|pages|lesson|practice|welcome|onboarding|sort|settings|complete
///   -exercise <kind>      first exercise of the lesson is this kind (mc, tf, bank, type, match, flash, apply, q-bank1 ...)
///   -lessonId <id>        lesson to open for -screen lesson (default lc1)
///   -autoanswer correct|wrong   answer the first exercise and show the feedback panel
///   -seedScreenshots      render Apple Books style pages and run them through Vision OCR + the import pipeline
enum DebugLaunch {
    static var args: [String] { ProcessInfo.processInfo.arguments }
    static func value(_ flag: String) -> String? {
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
    static var demo: Bool { args.contains("-demo") }
    static var screen: String? { value("-screen") }
    static var autoAnswer: String? { value("-autoanswer") }
    static var exerciseKind: ExerciseKind? { value("-exercise").flatMap(ExerciseKind.init(rawValue:)) }

    @MainActor static func makeStore() -> Store {
        let wantsFresh = demo || args.contains("-seedScreenshots") || args.contains("-seedFiles") || screen == "welcome" || screen == "onboarding"
        let store = Store(persist: !wantsFresh)
        if demo { store.library = demoLibrary(store.sample) }
        if screen == "welcome" || screen == "onboarding" { store.library = Library() }
        if (args.contains("-seedScreenshots") || args.contains("-seedFiles")) && !demo {
            var lib = demoLibrary(store.sample)
            lib.profile.onboarded = true
            store.library = lib
        }
        return store
    }

    static func demoLibrary(_ sample: Library) -> Library {
        var lib = Library()
        lib.profile.onboarded = true
        lib.profile.goals = ["ideas", "quotes"]
        lib.profile.practice = ["tap", "blank", "type"]
        lib.profile.dailyGoalXP = 20
        lib.profile.reminder = "20:00"
        let now = Date()
        lib.addSample(sample, now: now)
        func setLevel(_ id: String, _ level: Int) {
            if let i = lib.lessons.firstIndex(where: { $0.id == id }) { lib.lessons[i].level = level; lib.lessons[i].sessions = level }
        }
        setLevel("lc1", 3); setLevel("lcq", 1); setLevel("lc2", 1); setLevel("la1", 1); setLevel("lb1", 3); setLevel("lb2", 1)
        // Some cards reviewed before and due now, so Practice has work.
        for i in lib.cards.indices where ["lc1", "lcq", "la1", "lb1"].contains(lib.cards[i].lessonId) {
            lib.cards[i].srs = Srs(state: "review", ease: 2.5, interval: 1, due: ISO.string(now.addingTimeInterval(-3600)), reps: 1, lapses: 0)
        }
        let cal = Calendar.current
        for d in 1...5 {
            let day = DayKey.of(cal.date(byAdding: .day, value: -d, to: now)!)
            lib.stats.dayXP[day] = [22, 18, 31, 20, 25][d - 1]
            lib.events.append(LibraryEvent(t: ISO.string(cal.date(byAdding: .day, value: -d, to: now)!), name: "session_done", props: ["accuracy": 0.86, "seconds": 190, "xp": 22]))
        }
        lib.stats.xp = 342
        lib.stats.streak = 5
        lib.stats.longestStreak = 9
        lib.stats.lastActiveDay = DayKey.of(cal.date(byAdding: .day, value: -1, to: now)!)
        lib.stats.freezes = 1
        ProgressEngine.award(12, to: &lib.stats, now: now)
        lib.log("session_start", ["lessonKind": "theme", "level": 2, "projectId": "smpcarnegi"], now: now)
        return lib
    }

    @MainActor static func apply(store: Store, importer: Importer) {
        if args.contains("-seedScreenshots") {
            Task { await seedScreenshots(store: store, importer: importer) }
            return
        }
        if args.contains("-seedFiles") {
            Task { await DebugFixtures.seedFiles(store: store, importer: importer) }
            return
        }
        guard let screen else { return }
        let lessonId = value("-lessonId") ?? (exerciseKind?.isQuote == true ? "lcq" : "lc1")
        switch screen {
        case "path": store.path = [.project("smpcarnegi")]
        case "pages": store.path = [.project("smpcarnegi")]; UserDefaults.standard.set(1, forKey: "debug.projectTab")
        case "sort": store.path = [.sort]
        case "settings": store.path = [.settings]
        case "plan": store.path = [.plan]
        case "bio": store.path = [.project("smpbio101")]
        case "testresult": store.startTest(projectId: "smpbio101")
        case "lesson", "complete":
            guard var lesson = store.library.lessons.first(where: { $0.id == lessonId }) else { return }
            if let k = exerciseKind {
                var rng = SystemRandomNumberGenerator()
                lesson.level = k.isQuote ? 4 : 4
                var ex = SessionBuilder.build(lesson: lesson, cards: store.library.cards(of: lesson.id), projectCards: store.library.cards(ofProject: lesson.projectId), profile: store.library.profile, rng: &rng)
                let cards = store.library.cards(of: lesson.id)
                if k == .match, cards.count >= 4 {
                    ex.insert(SessionBuilder.makeMatch(Array(cards.prefix(4)), rng: &rng), at: 0)
                } else if let c = cards.first(where: { $0.id == value("-cardId") }) ?? cards.first {
                    ex.insert(SessionBuilder.make(k, card: c, extraWords: store.library.cards.flatMap { SessionBuilder.longWords($0.statement) }, defs: store.library.cards(ofProject: lesson.projectId).filter(\.isDefinition), rng: &rng), at: 0)
                }
                store.session = SessionLaunch(lessonId: lesson.id, projectId: lesson.projectId, exercises: Array(ex.prefix(10)), title: lesson.title)
            } else {
                store.start(lesson: lesson)
            }
        case "practice": _ = store.startPractice()
        default: break
        }
    }

    // MARK: Generated Apple Books style screenshots through the real OCR pipeline

    static let pages: [(header: String, body: String)] = [
        ("Walden", "The mass of men lead lives of quiet desperation. What is called resignation is confirmed desperation. From the desperate city you go into the desperate country, and have to console yourself with the bravery of minks and muskrats. A stereotyped but unconscious despair is concealed even under what are called the games and amusements of mankind. There is no play in them, for this comes after work. But it is a characteristic of wisdom not to do desperate things."),
        ("Walden", "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary. Our life is frittered away by detail. Simplify, simplify. Let us spend one day as deliberately as Nature."),
        ("Walden", "Most of the luxuries, and many of the so-called comforts of life, are not only not indispensable, but positive hindrances to the elevation of mankind. With respect to luxuries and comforts, the wisest have ever lived a more simple and meagre life than the poor. None can be an impartial or wise observer of human life but from the vantage ground of what we should call voluntary poverty. Be it life or literature, keep the simplicity of the facts."),
    ]

    static func renderBookPage(header: String, body: String, page: Int) -> UIImage {
        let size = CGSize(width: 1179, height: 2556)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor(hex: 0xFBF8F1).setFill(); ctx.fill(CGRect(origin: .zero, size: size))
            let status: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 48, weight: .semibold), .foregroundColor: UIColor.black]
            ("9:41" as NSString).draw(at: CGPoint(x: 140, y: 52), withAttributes: status)
            ("100%" as NSString).draw(at: CGPoint(x: 940, y: 52), withAttributes: status)
            let para = NSMutableParagraphStyle(); para.alignment = .center
            let head: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 40, weight: .medium), .foregroundColor: UIColor(hex: 0x8A8478), .paragraphStyle: para]
            (header as NSString).draw(in: CGRect(x: 100, y: 175, width: 979, height: 60), withAttributes: head)
            let bodyPara = NSMutableParagraphStyle(); bodyPara.lineSpacing = 22; bodyPara.alignment = .justified
            let serif = UIFont(descriptor: UIFont.systemFont(ofSize: 58).fontDescriptor.withDesign(.serif)!, size: 58)
            let text: [NSAttributedString.Key: Any] = [.font: serif, .foregroundColor: UIColor(hex: 0x1C1A17), .paragraphStyle: bodyPara]
            (body as NSString).draw(in: CGRect(x: 96, y: 330, width: 987, height: 1900), withAttributes: text)
            let foot: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 38, weight: .medium), .foregroundColor: UIColor(hex: 0x8A8478), .paragraphStyle: para]
            ("\(page) of 312" as NSString).draw(in: CGRect(x: 100, y: 2420, width: 979, height: 60), withAttributes: foot)
        }
    }

    static func renderNonBook() -> UIImage {
        let size = CGSize(width: 1179, height: 2556)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(origin: .zero, size: size))
            let a: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 64, weight: .bold), .foregroundColor: UIColor.black]
            ("Settings" as NSString).draw(at: CGPoint(x: 80, y: 300), withAttributes: a)
            for (i, s) in ["Wi-Fi", "Bluetooth", "Battery 82%", "Screen Time 3h 12m"].enumerated() {
                (s as NSString).draw(at: CGPoint(x: 80, y: 500 + i * 140), withAttributes: a)
            }
        }
    }

    @MainActor static func seedScreenshots(store: Store, importer: Importer) async {
        let images = pages.enumerated().map { renderBookPage(header: $0.element.header, body: $0.element.body, page: 41 + $0.offset) } + [renderNonBook()]
        importer.store = store
        for img in images { await importer.ingest(ImageInput(image: img, isScreenshotAsset: true)) }
        store.library.log("import", ["kind": "screenshot", "count": .number(Double(importer.imported)), "skipped": .number(Double(importer.skipped))])
        importer.message = "\(importer.imported) pages added, \(importer.skipped) skipped (not book pages)"
        store.toast = importer.message
        print("SEED_OCR imported=\(importer.imported) skipped=\(importer.skipped)")
        for p in store.library.inbox { print("SEED_OCR page header=\(p.header ?? "-") words=\(TextKit.wordCount(p.text)) text=\(p.text.prefix(120))") }
        store.path = [.sort]
    }
}
#endif

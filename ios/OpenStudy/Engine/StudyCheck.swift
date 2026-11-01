import Foundation

/// The study check (spec 14.3): screens how you study for common study biases, using only what the
/// library already records (sessions, tests, reviews, pages). Deterministic, no model, on the device.
/// Free shows the checklist; Plus adds the numbers, what to do, and an export.
public enum StudyCheck {
    public enum Status: String { case ok, flag, unknown }

    public struct Item: Identifiable, Equatable {
        public var id: String
        public var title: String
        public var status: Status
        /// One line for the checklist.
        public var summary: String
        /// The numbers behind it (full report).
        public var detail: String
        /// What to do about it (full report).
        public var tip: String
    }

    public static func run(_ lib: Library, now: Date = Date(), calendar: Calendar = .current) -> [Item] {
        let since = calendar.date(byAdding: .day, value: -14, to: now)!
        func date(_ e: LibraryEvent) -> Date { ISO.date(e.t) ?? .distantPast }
        let done = lib.events.filter { $0.name == "session_done" && date($0) >= since && date($0) <= now }
        let days = Set(done.map { DayKey.of(date($0), calendar: calendar) })
        let tests = lib.events.filter { $0.name == "test_done" }
        let lessonAcc = done.filter { $0.props?["lessonId"] != nil }.compactMap { $0.props?["accuracy"]?.doubleValue }
        let testAcc = tests.suffix(3).compactMap { $0.props?["accuracy"]?.doubleValue }
        let overdue = lib.cards.filter { c in
            guard c.srs.reps > 0, let due = ISO.date(c.srs.due) else { return false }
            return due < now.addingTimeInterval(-2 * 86_400)
        }.count
        let ownPages = lib.pages.filter { p in p.projectId.map { lib.project($0)?.sample != true } ?? true }.count
        let studied = lib.cards.filter { $0.srs.reps > 0 }.count
        let formats = Set(lib.profile.practice)

        var items: [Item] = []

        // Spacing: cramming feels productive but fades fast.
        if done.count < 3 {
            items.append(Item(id: "spacing", title: "Spacing", status: .unknown,
                              summary: "Study on a few more days to check this.",
                              detail: "\(done.count) \(done.count == 1 ? "session" : "sessions") in the last 14 days.",
                              tip: "Short sessions on separate days beat one long one."))
        } else {
            let crammed = days.count <= 2
            items.append(Item(id: "spacing", title: "Spacing", status: crammed ? .flag : .ok,
                              summary: crammed ? "Most of your study lands on one or two days." : "You spread study across the days.",
                              detail: "\(done.count) sessions on \(days.count) of the last 14 days.",
                              tip: crammed ? "Split the same time into 10 minutes on more days. Your plan spaces it for you." : "Keep the rhythm. Spacing is what makes it stick."))
        }

        // Overconfidence: lessons feel easier than a mixed test.
        if let l = average(lessonAcc), let t = average(testAcc) {
            let gap = l - t
            items.append(Item(id: "confidence", title: "Confidence vs. results", status: gap > 0.15 ? .flag : .ok,
                              summary: gap > 0.15 ? "Lessons feel easier than your tests show." : "Your lesson scores hold up in tests.",
                              detail: "Lessons \(pct(l)), practice tests \(pct(t)).",
                              tip: gap > 0.15 ? "Take a practice test before you feel ready, then review your misses." : "Keep testing yourself now and then."))
        } else {
            items.append(Item(id: "confidence", title: "Confidence vs. results", status: .unknown,
                              summary: "Take a practice test to check this.",
                              detail: tests.isEmpty ? "No practice tests yet." : "Not enough lessons yet to compare.",
                              tip: "A mixed test shows what you know without the lesson's hints."))
        }

        // Avoiding weak spots: reviews left to pile up.
        items.append(Item(id: "reviews", title: "Reviews", status: overdue >= 10 ? .flag : (studied == 0 ? .unknown : .ok),
                          summary: overdue >= 10 ? "Reviews are piling up." : (studied == 0 ? "Finish a lesson to start reviews." : "You keep up with reviews."),
                          detail: "\(overdue) \(overdue == 1 ? "card is" : "cards are") more than 2 days overdue.",
                          tip: overdue >= 10 ? "Do Practice first next time. A few minutes clears the oldest cards." : "Reviews are the cheapest minutes you spend."))

        // Saving vs. studying: collecting pages feels like learning.
        let collecting = ownPages >= 20 && studied < ownPages / 4
        items.append(Item(id: "saving", title: "Saving vs. studying", status: ownPages < 5 ? .unknown : (collecting ? .flag : .ok),
                          summary: ownPages < 5 ? "Add your own material to check this." : (collecting ? "You save much more than you study." : "You study what you save."),
                          detail: "\(ownPages) pages saved, \(studied) cards studied.",
                          tip: collecting ? "Pick one study set and finish its first lesson before adding more." : "Keep adding only what you plan to learn."))

        // Variety: one format trains one kind of recall.
        items.append(Item(id: "variety", title: "Question variety", status: formats.count <= 1 ? .flag : .ok,
                          summary: formats.count <= 1 ? "You practice in only one format." : "You mix question formats.",
                          detail: "Formats on: \(formats.count) of 4.",
                          tip: formats.count <= 1 ? "Turn on typing from memory in settings. Recall beats recognition." : "Mixed formats test the idea, not the wording."))

        return items
    }

    public static func flagged(_ items: [Item]) -> Int { items.filter { $0.status == .flag }.count }

    /// Plain text for the export (Plus).
    public static func report(_ items: [Item], now: Date = Date()) -> String {
        var lines = ["OpenStudy study check, \(DayKey.of(now))", ""]
        for i in items {
            let mark = i.status == .ok ? "OK" : (i.status == .flag ? "Check" : "Not enough data")
            lines.append("\(i.title): \(mark)")
            lines.append(i.summary)
            lines.append(i.detail)
            lines.append("What to do: \(i.tip)")
            lines.append("")
        }
        lines.append("Based on your own study history. Not medical or research advice.")
        return lines.joined(separator: "\n")
    }

    static func average(_ xs: [Double]) -> Double? { xs.isEmpty ? nil : xs.reduce(0, +) / Double(xs.count) }
    static func pct(_ x: Double) -> String { "\(Int((x * 100).rounded()))%" }
}

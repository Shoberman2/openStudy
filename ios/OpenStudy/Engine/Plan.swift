import Foundation

// MARK: - Study plan (spec 8.6)

public struct PlanItem: Identifiable, Equatable {
    public enum Kind: String { case review, lesson, test }
    public var id: String
    public var kind: Kind
    public var projectId: String?
    public var lessonId: String?
    public var minutes: Double
    public var cards: Int
    public var title: String
    public var subtitle: String
    public var done: Bool
}

public struct PlanDay: Identifiable, Equatable {
    public var id: String { key }
    public var key: String              // "YYYY-MM-DD"
    public var date: Date
    public var items: [PlanItem]
    public var budget: Double
    public var exams: [String]          // project ids with goalDate on this day
    public var minutes: Double { items.reduce(0) { $0 + $1.minutes } }
}

public struct Feasibility: Equatable {
    public var projectId: String
    public var title: String
    public var goalDate: String
    public var minutesNeeded: Int
}

public struct StudyPlan: Equatable {
    public var days: [PlanDay]
    public var feasibility: [Feasibility]
    public var today: PlanDay? { days.first }
}

public enum PlanEngine {
    public static let lessonMinutes = 4.0
    public static let quotesMinutes = 3.0
    public static let testMinutes = 8.0
    public static let reviewMinutesPerCard = 0.3
    public static let readyLevel = 3
    public static let masteredLevel = 5

    public static func goalMinutes(_ xp: Int) -> Double {
        switch xp { case ...10: return 5; case ...20: return 10; case ...30: return 15; default: return 20 }
    }

    static func cost(_ l: Lesson) -> Double { l.isQuotes ? quotesMinutes : lessonMinutes }

    /// Weak lessons from the most recent practice test of a project (accuracy < 70%).
    public static func weakLessons(_ lib: Library, projectId: String) -> Set<String> {
        guard let e = lib.events.last(where: { $0.name == "test_done" && $0.props?["projectId"]?.stringValue == projectId }),
              let s = e.props?["weakLessons"]?.stringValue else { return [] }
        return Set(s.split(separator: ",").map(String.init).filter { !$0.isEmpty })
    }

    public static func build(_ lib: Library, now: Date = Date(), calendar: Calendar = .current) -> StudyPlan {
        let today = calendar.startOfDay(for: now)
        let todayKey = DayKey.of(today, calendar: calendar)
        func dayIndex(_ key: String) -> Int? { DayKey.days(from: todayKey, to: key, calendar: calendar) }

        let goalProjects = lib.projects.filter { p in p.goalDate.flatMap(dayIndex).map { $0 >= 0 } ?? false }
        let lastGoal = goalProjects.compactMap { $0.goalDate.flatMap(dayIndex) }.max() ?? 0
        let horizon = max(6, lastGoal)
        let overrides = lib.projects.compactMap(\.minutesPerDay).reduce(0, +)
        let budget = max(goalMinutes(lib.profile.dailyGoalXP), Double(overrides))

        // Simulated state.
        var level: [String: Int] = Dictionary(uniqueKeysWithValues: lib.lessons.map { ($0.id, $0.level) })
        var lastDay: [String: Int] = [:]
        var doneToday: [PlanItem] = []
        let lessonById = Dictionary(uniqueKeysWithValues: lib.lessons.map { ($0.id, $0) })
        for e in lib.events {
            guard let d = ISO.date(e.t), let idx = dayIndex(DayKey.of(d, calendar: calendar)) else { continue }
            if e.name == "session_done", let lid = e.props?["lessonId"]?.stringValue {
                lastDay[lid] = max(lastDay[lid] ?? Int.min, idx)
                if idx == 0, let l = lessonById[lid], !doneToday.contains(where: { $0.lessonId == lid }) {
                    doneToday.append(PlanItem(id: "\(todayKey)-done-\(lid)", kind: .lesson, projectId: l.projectId, lessonId: lid, minutes: cost(l), cards: 0,
                                              title: l.title, subtitle: lib.project(l.projectId)?.title ?? "", done: true))
                }
            }
            if idx == 0, e.name == "review_done", !doneToday.contains(where: { $0.kind == .review }) {
                let n = Int(e.props?["count"]?.doubleValue ?? 0)
                doneToday.append(PlanItem(id: "\(todayKey)-done-review", kind: .review, projectId: nil, lessonId: nil, minutes: Double(n) * reviewMinutesPerCard,
                                          cards: n, title: "Review \(n) cards", subtitle: "Due today", done: true))
            }
            if idx == 0, e.name == "test_done", let pid = e.props?["projectId"]?.stringValue, !doneToday.contains(where: { $0.kind == .test && $0.projectId == pid }) {
                doneToday.append(PlanItem(id: "\(todayKey)-done-test-\(pid)", kind: .test, projectId: pid, lessonId: nil, minutes: testMinutes, cards: 0,
                                          title: "Practice test", subtitle: lib.project(pid)?.title ?? "", done: true))
            }
        }
        // Projected SRS dues for cards already in review.
        var due: [String: Date] = [:]
        var srs: [String: Srs] = [:]
        for c in lib.cards where c.srs.state != "new" { due[c.id] = c.srs.dueDate; srs[c.id] = c.srs }

        let projects = lib.projects.sorted { a, b in
            let ga = a.goalDate ?? "9999", gb = b.goalDate ?? "9999"
            return ga != gb ? ga < gb : a.createdAt < b.createdAt
        }
        let weak = Dictionary(uniqueKeysWithValues: lib.projects.map { ($0.id, weakLessons(lib, projectId: $0.id)) })
        var testDone = Set(doneToday.filter { $0.kind == .test }.compactMap(\.projectId))

        var days: [PlanDay] = []
        for d in 0...horizon {
            let date = calendar.date(byAdding: .day, value: d, to: today)!
            let key = DayKey.of(date, calendar: calendar)
            let endOfDay = calendar.date(byAdding: .day, value: 1, to: date)!
            var items: [PlanItem] = d == 0 ? doneToday : []
            var used = items.reduce(0) { $0 + $1.minutes }
            var usedLessons = Set(items.compactMap(\.lessonId))

            // 1. Reviews first, capped at 40% of the day's minutes; overflow rolls over.
            if !(d == 0 && items.contains { $0.kind == .review }) {
                let dueIds = due.filter { $0.value < endOfDay }.sorted { $0.value != $1.value ? $0.value < $1.value : $0.key < $1.key }.map(\.key)
                let cap = Int((budget * 0.4 / reviewMinutesPerCard).rounded(.down))
                let take = Array(dueIds.prefix(cap))
                if !take.isEmpty {
                    let m = Double(take.count) * reviewMinutesPerCard
                    items.append(PlanItem(id: "\(key)-review", kind: .review, projectId: nil, lessonId: nil, minutes: m, cards: take.count,
                                          title: "Review \(take.count) \(take.count == 1 ? "card" : "cards")", subtitle: "Spaced review", done: false))
                    used += m
                    for id in take {
                        let next = SRSEngine.review(srs[id]!, grade: .good, now: date, calendar: calendar)
                        srs[id] = next; due[id] = next.dueDate
                    }
                }
            }

            // 2. Practice tests on goal-1, goal-3 and goal-7.
            var exams: [String] = []
            for p in goalProjects {
                guard let g = p.goalDate.flatMap(dayIndex) else { continue }
                if g == d { exams.append(p.id) }
                if [g - 1, g - 3, g - 7].contains(d), !(d == 0 && testDone.contains(p.id)) {
                    items.append(PlanItem(id: "\(key)-test-\(p.id)", kind: .test, projectId: p.id, lessonId: nil, minutes: testMinutes, cards: 0,
                                          title: "Practice test", subtitle: p.title, done: false))
                    used += testMinutes
                    if d == 0 { testDone.insert(p.id) }
                }
            }

            // 3. New learning and strengthening, round robin across projects.
            var rotation: [Project] = []
            for p in projects {
                let g = p.goalDate.flatMap(dayIndex)
                if let g, g < d { continue }  // goal passed
                rotation.append(p)
                if let g, g - d <= 14 { rotation.append(p) }
            }
            // Interleave the weight-2 duplicates instead of placing them back to back.
            rotation = interleave(rotation)
            var progress = true
            while used < budget && progress {
                progress = false
                for p in rotation where used < budget {
                    let g = p.goalDate.flatMap(dayIndex)
                    let closeToGoal = g.map { $0 - d <= 2 } ?? false
                    let ls = lib.lessons(of: p.id)
                    let candidates = ls.filter { l in
                        (level[l.id] ?? 0) < readyLevel && !usedLessons.contains(l.id) &&
                        (lastDay[l.id].map { closeToGoal ? d - $0 >= 1 : d - $0 >= 2 } ?? true)
                    }
                    let w = weak[p.id] ?? []
                    guard let l = candidates.first(where: { w.contains($0.id) }) ?? candidates.first else { continue }
                    let lv = level[l.id] ?? 0
                    items.append(PlanItem(id: "\(key)-lesson-\(l.id)", kind: .lesson, projectId: p.id, lessonId: l.id, minutes: cost(l), cards: 0,
                                          title: l.title, subtitle: "\(p.title), " + (lv == 0 ? "new" : "level \(lv + 1)"), done: false))
                    used += cost(l)
                    usedLessons.insert(l.id)
                    level[l.id] = lv + 1
                    lastDay[l.id] = d
                    progress = true
                }
            }
            days.append(PlanDay(key: key, date: date, items: items, budget: budget, exams: exams))
        }

        // Feasibility: every lesson ready by goal-1?
        var feas: [Feasibility] = []
        for p in goalProjects {
            guard let g = p.goalDate.flatMap(dayIndex) else { continue }
            let ls = lib.lessons(of: p.id)
            let late = ls.filter { l in
                guard let r = planReadyDay(days, lesson: l, base: l.level) else { return true }
                return r > max(0, g - 1)
            }
            guard !late.isEmpty else { continue }
            let sessions = ls.reduce(0.0) { $0 + Double(max(0, readyLevel - $1.level)) * cost($1) }
            let tests = Double([g - 1, g - 3, g - 7].filter { $0 >= 0 }.count) * testMinutes
            let daysAvail = Double(max(1, g))
            var need = Int(((sessions + tests) / daysAvail / 0.6).rounded(.up))
            need = max(need, Int(budget) + 5)
            need = Int((Double(need) / 5).rounded(.up)) * 5
            feas.append(Feasibility(projectId: p.id, title: p.title, goalDate: p.goalDate!, minutesNeeded: need))
        }
        return StudyPlan(days: days, feasibility: feas)
    }

    /// The single "next thing to learn": the first not-done lesson item in the plan, today first, then later days.
    /// With a project id, only that project's lessons count.
    public static func nextLesson(_ lib: Library, projectId: String? = nil, todayOnly: Bool = false, now: Date = Date()) -> Lesson? {
        let plan = build(lib, now: now)
        let days = todayOnly ? Array(plan.days.prefix(1)) : plan.days
        for d in days {
            for it in d.items where it.kind == .lesson && !it.done && (projectId == nil || it.projectId == projectId) {
                if let l = lib.lessons.first(where: { $0.id == it.lessonId }) { return l }
            }
        }
        return nil
    }

    /// Day index on which a lesson reaches ready in the plan, if it does.
    static func planReadyDay(_ days: [PlanDay], lesson: Lesson, base: Int) -> Int? {
        if base >= readyLevel { return 0 }
        var lv = base
        for (i, d) in days.enumerated() {
            for it in d.items where it.lessonId == lesson.id && it.kind == .lesson && !it.done {
                lv += 1
                if lv >= readyLevel { return i }
            }
        }
        return nil
    }

    static func interleave(_ ps: [Project]) -> [Project] {
        var firsts: [Project] = []
        var seconds: [Project] = []
        for p in ps { if firsts.contains(where: { $0.id == p.id }) { seconds.append(p) } else { firsts.append(p) } }
        var out: [Project] = []
        for (i, p) in firsts.enumerated() { out.append(p); if i < seconds.count { out.append(seconds[i]) } }
        if seconds.count > firsts.count { out += seconds[firsts.count...] }
        return out
    }
}

// MARK: - Practice test (spec 8.6)

public struct LessonScore: Equatable { public var lessonId: String; public var title: String; public var correct: Int; public var total: Int
    public var accuracy: Double { total == 0 ? 0 : Double(correct) / Double(total) }
}

public struct TestResult: Equatable {
    public var accuracy: Double
    public var perLesson: [LessonScore]
    public var weakLessons: [String]
    public var missedCards: [String]
}

public enum PracticeTest {
    /// 20 questions (or all cards if fewer) across all lessons, recall heavy (type, term-type, tf, mc).
    public static func build<R: RandomNumberGenerator>(project: Project, lib: Library, rng: inout R) -> [Exercise] {
        let lessons = lib.lessons(of: project.id)
        var buckets = lessons.map { l in SessionBuilder.orderCards(lib.cards(of: l.id), now: Date()) }
        var picked: [Card] = []
        while picked.count < 20, buckets.contains(where: { !$0.isEmpty }) {
            for i in buckets.indices where picked.count < 20 && !buckets[i].isEmpty { picked.append(buckets[i].removeFirst()) }
        }
        let projectCards = lib.cards(ofProject: project.id)
        let defs = projectCards.filter(\.isDefinition)
        let extra = projectCards.flatMap { SessionBuilder.longWords($0.statement) }
        return picked.enumerated().map { i, c in
            let kind: ExerciseKind
            if c.isQuote { kind = .qLetters }
            else {
                switch i % 4 {
                case 0, 3: kind = c.isDefinition ? .termType : .type
                case 1: kind = .tf
                default: kind = c.isDefinition ? .defMc : .mc
                }
            }
            return SessionBuilder.make(kind, card: c, extraWords: extra, defs: defs, rng: &rng)
        }
    }

    public static func score(log: [(cardIds: [String], passed: Bool)], lib: Library, projectId: String) -> TestResult {
        let cardById = Dictionary(uniqueKeysWithValues: lib.cards.map { ($0.id, $0) })
        var per: [String: (Int, Int)] = [:]
        var missed: [String] = []
        for entry in log {
            for id in entry.cardIds {
                guard let c = cardById[id] else { continue }
                per[c.lessonId, default: (0, 0)].1 += 1
                if entry.passed { per[c.lessonId]!.0 += 1 } else if !missed.contains(id) { missed.append(id) }
            }
        }
        let lessons = lib.lessons(of: projectId).filter { per[$0.id] != nil }
        let scores = lessons.map { LessonScore(lessonId: $0.id, title: $0.title, correct: per[$0.id]!.0, total: per[$0.id]!.1) }
        let total = log.count
        let correct = log.filter(\.passed).count
        return TestResult(accuracy: total == 0 ? 0 : Double(correct) / Double(total), perLesson: scores,
                          weakLessons: scores.filter { $0.accuracy < 0.7 }.map(\.lessonId), missedCards: missed)
    }
}

import Foundation

// MARK: - Answer checking (spec 5.3)

public enum CheckResult: String, Equatable { case correct, close, wrong
    public var passes: Bool { self != .wrong }
}

public enum DiffKind: Equatable { case same, missing, extra }
public struct DiffToken: Equatable, Hashable { public var word: String; public var kind: DiffKind }

public enum AnswerChecker {
    public static func normalize(_ s: String) -> String {
        var ws = TextKit.rawWords(s.replacingOccurrences(of: "\u{2019}", with: "'")).map { $0.replacingOccurrences(of: "'", with: "") }
        while let f = ws.first, ["the", "a", "an"].contains(f), ws.count > 1 { ws.removeFirst() }
        return ws.joined(separator: " ")
    }

    public static func levenshtein(_ a: String, _ b: String) -> Int {
        let x = Array(a), y = Array(b)
        if x.isEmpty { return y.count }
        if y.isEmpty { return x.count }
        var prev = Array(0...y.count)
        var cur = [Int](repeating: 0, count: y.count + 1)
        for i in 1...x.count {
            cur[0] = i
            for j in 1...y.count {
                cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] == y[j - 1] ? 0 : 1))
            }
            swap(&prev, &cur)
        }
        return prev[y.count]
    }

    public static func check(_ given: String, against target: String) -> CheckResult {
        let g = normalize(given), t = normalize(target)
        guard !g.isEmpty else { return .wrong }
        if g == t { return .correct }
        return levenshtein(g, t) <= max(1, Int(Double(t.count) * 0.15)) ? .close : .wrong
    }

    static func quoteWords(_ s: String) -> [String] {
        TextKit.rawWords(s.replacingOccurrences(of: "\u{2019}", with: "'")).map { $0.replacingOccurrences(of: "'", with: "") }
    }

    /// Word-level LCS ratio against the target.
    public static func lcsRatio(_ given: String, _ target: String) -> Double {
        let g = quoteWords(given), t = quoteWords(target)
        guard !t.isEmpty else { return 0 }
        return Double(lcsLength(g, t)) / Double(t.count)
    }

    static func lcsLength(_ a: [String], _ b: [String]) -> Int {
        guard !a.isEmpty, !b.isEmpty else { return 0 }
        var prev = [Int](repeating: 0, count: b.count + 1)
        for i in 0..<a.count {
            var cur = [Int](repeating: 0, count: b.count + 1)
            for j in 0..<b.count {
                cur[j + 1] = a[i] == b[j] ? prev[j] + 1 : max(prev[j + 1], cur[j])
            }
            prev = cur
        }
        return prev[b.count]
    }

    public static func checkQuote(_ given: String, against target: String) -> CheckResult {
        let r = lcsRatio(given, target)
        if r >= 0.9 { return .correct }
        if r >= 0.75 { return .close }
        return .wrong
    }

    /// Word diff for quotes: target words not typed are `missing`, typed words not in the target are `extra`.
    public static func diff(_ given: String, _ target: String) -> [DiffToken] {
        let gRaw = TextKit.words(given), tRaw = TextKit.words(target)
        let g = gRaw.map { quoteWords($0).joined() }, t = tRaw.map { quoteWords($0).joined() }
        var dp = [[Int]](repeating: [Int](repeating: 0, count: t.count + 1), count: g.count + 1)
        for i in stride(from: g.count - 1, through: 0, by: -1) {
            for j in stride(from: t.count - 1, through: 0, by: -1) {
                dp[i][j] = g[i] == t[j] ? dp[i + 1][j + 1] + 1 : max(dp[i + 1][j], dp[i][j + 1])
            }
        }
        var out: [DiffToken] = []
        var i = 0, j = 0
        while i < g.count && j < t.count {
            if g[i] == t[j] { out.append(DiffToken(word: tRaw[j], kind: .same)); i += 1; j += 1 }
            else if dp[i + 1][j] >= dp[i][j + 1] { out.append(DiffToken(word: gRaw[i], kind: .extra)); i += 1 }
            else { out.append(DiffToken(word: tRaw[j], kind: .missing)); j += 1 }
        }
        while i < g.count { out.append(DiffToken(word: gRaw[i], kind: .extra)); i += 1 }
        while j < t.count { out.append(DiffToken(word: tRaw[j], kind: .missing)); j += 1 }
        return out
    }
}

// MARK: - SRS (spec 5.4)

public enum Grade: String, CaseIterable { case again, hard, good, easy }

public enum SRSEngine {
    public static func review(_ s: Srs, grade: Grade, now: Date = Date(), calendar: Calendar = .current) -> Srs {
        var n = s
        if grade == .again {
            if n.reps > 0 { n.lapses += 1 }
            n.reps = 0
            n.interval = 0
            n.ease = max(1.3, n.ease - 0.2)
            n.state = "learning"
            n.due = ISO.string(now.addingTimeInterval(10 * 60))
            return n
        }
        n.reps += 1
        if n.reps == 1 { n.interval = 1 }
        else if n.reps == 2 { n.interval = 3 }
        else {
            let mult = grade == .hard ? 0.8 : grade == .easy ? 1.3 : 1.0
            n.interval = max(1, Int((Double(n.interval) * n.ease * mult).rounded()))
        }
        n.ease += grade == .hard ? -0.15 : grade == .easy ? 0.15 : 0
        n.ease = min(3.0, max(1.3, n.ease))
        n.ease = (n.ease * 100).rounded() / 100
        n.state = "review"
        let start = calendar.startOfDay(for: now)
        n.due = ISO.string(calendar.date(byAdding: .day, value: n.interval, to: start) ?? start)
        return n
    }

    /// Maps an answer to a grade (spec 5.4 Mapping).
    public static func grade(for result: CheckResult, kind: ExerciseKind, seconds: Double) -> Grade {
        switch result {
        case .wrong: return .again
        case .close: return .hard
        case .correct: return (kind == .type || kind == .qRecall) && seconds < 6 ? .easy : .good
        }
    }
}

// MARK: - XP, streak, goal (spec 5.5)

public enum ProgressEngine {
    public static let maxFreezes = 2

    public static func sessionXP(correctFirstAttempts: Int, completed: Bool, mistakes: Int, applies: Int) -> Int {
        correctFirstAttempts + (completed ? 10 : 0) + (completed && mistakes == 0 ? 5 : 0) + applies * 3
    }

    /// Adds XP and updates the streak on the first XP of a local day.
    public static func award(_ xp: Int, to stats: inout Stats, now: Date = Date(), calendar: Calendar = .current) {
        guard xp > 0 else { return }
        let today = DayKey.of(now, calendar: calendar)
        if stats.lastActiveDay != today {
            let gap = stats.lastActiveDay.flatMap { DayKey.days(from: $0, to: today, calendar: calendar) }
            switch gap {
            case .some(1):
                stats.streak += 1
            case .some(2) where stats.freezes > 0:
                stats.freezes -= 1
                stats.streak += 1
            default:
                stats.streak = 1
            }
            if stats.streak > 0 && stats.streak % 7 == 0 { stats.freezes = min(maxFreezes, stats.freezes + 1) }
            stats.longestStreak = max(stats.longestStreak, stats.streak)
            stats.lastActiveDay = today
        }
        stats.xp += xp
        stats.dayXP[today, default: 0] += xp
    }

    /// Streak as it should be displayed today (0 when it has lapsed beyond what a freeze can save).
    public static func displayStreak(_ stats: Stats, now: Date = Date(), calendar: Calendar = .current) -> Int {
        guard let last = stats.lastActiveDay, let gap = DayKey.days(from: last, to: DayKey.of(now, calendar: calendar), calendar: calendar) else { return 0 }
        if gap <= 1 { return stats.streak }
        if gap == 2 && stats.freezes > 0 { return stats.streak }
        return 0
    }

    public static func goalProgress(_ lib: Library, now: Date = Date(), calendar: Calendar = .current) -> Double {
        let today = DayKey.of(now, calendar: calendar)
        return min(1, Double(lib.stats.dayXP[today] ?? 0) / Double(max(1, lib.profile.dailyGoalXP)))
    }
}

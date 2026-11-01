import Foundation

/// OpenStudy Plus on iOS (spec 14): two plans in one subscription group, a 7-day free trial, and a
/// free tier with monthly limits. Pure rules, no StoreKit, so they are unit tested.
public enum PlusPlan: String, CaseIterable, Identifiable {
    case yearly, monthly
    public var id: String { rawValue }

    public var productId: String {
        switch self {
        case .monthly: return Billing.productId
        case .yearly: return Billing.yearlyProductId
        }
    }
    /// Shown until the App Store's localized price loads.
    public var fallbackPrice: String { self == .monthly ? "$7.99" : "$59.99" }
    public var period: String { self == .monthly ? "month" : "year" }
    public var title: String { self == .monthly ? "Monthly" : "Yearly" }

    public static func from(productId: String) -> PlusPlan? { allCases.first { $0.productId == productId } }
}

public enum PlusLimits {
    /// Study sets a free account can make from its own material each month (sample sets never count).
    public static let freeStudySets = 3
    /// Lessons, practice and practice tests on your own material each month.
    public static let freeQuizzes = 10
}

/// What the free tier has used this calendar month. Kept on the device; resets on the 1st.
public struct MonthlyUsage: Codable, Equatable {
    public var month: String
    public var studySets: Int
    public var quizzes: Int

    public init(month: String, studySets: Int = 0, quizzes: Int = 0) {
        self.month = month; self.studySets = studySets; self.quizzes = quizzes
    }

    public static func monthKey(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0)
    }

    /// This month's usage: the same record, or a fresh one when the month changed.
    public func current(_ now: Date = Date()) -> MonthlyUsage {
        let key = Self.monthKey(now)
        return key == month ? self : MonthlyUsage(month: key)
    }

    public var studySetsLeft: Int { max(0, PlusLimits.freeStudySets - studySets) }
    public var quizzesLeft: Int { max(0, PlusLimits.freeQuizzes - quizzes) }
}

/// Everything the paywall and the gates need to decide, in one place.
public enum PlusGate {
    public enum Action: String { case studySet = "create_project", quiz = "lesson", fullReport = "report", export = "export", sync = "sync" }

    /// True when the free tier allows `action` (Plus allows everything; sample material is always free).
    public static func allowed(_ action: Action, plus: Bool, sample: Bool = false, usage: MonthlyUsage, count: Int = 1) -> Bool {
        if plus || sample { return true }
        switch action {
        case .studySet: return usage.studySets + count <= PlusLimits.freeStudySets
        case .quiz: return usage.quizzes < PlusLimits.freeQuizzes
        case .fullReport, .export, .sync: return false
        }
    }

    /// The short line under the paywall title that says why it opened.
    public static func reason(_ from: String) -> String? {
        switch from {
        case "create_project", "create_all": return "You've made your \(PlusLimits.freeStudySets) free study sets this month."
        case "lesson", "practice", "test", "connection": return "You've used your \(PlusLimits.freeQuizzes) free quizzes this month."
        case "report": return "The full study check report comes with Plus."
        case "export", "sync": return "Backing up and moving your shelf comes with Plus."
        default: return nil
        }
    }

    /// "7 days free, then $59.99 a year." (or without the trial when it was used).
    public static func priceLine(plan: PlusPlan, price: String?, trial: Bool) -> String {
        let p = price ?? plan.fallbackPrice
        return trial ? "7 days free, then \(p) a \(plan.period)." : "\(p) a \(plan.period)."
    }

    /// The yearly plan's saving against twelve months, as a whole percent ("Save 37%").
    public static func yearlySaving(monthly: Decimal, yearly: Decimal) -> Int? {
        guard monthly > 0 else { return nil }
        let full = NSDecimalNumber(decimal: monthly * 12).doubleValue
        let y = NSDecimalNumber(decimal: yearly).doubleValue
        guard full > y else { return nil }
        return Int(((full - y) / full * 100).rounded(.down))
    }
}

extension Library {
    /// True when a model wrote this lesson's questions (spec 13.6), so the session shows the AI label.
    public func aiWritten(lessonId: String?) -> Bool {
        guard let lessonId else { return false }
        return events.contains { e in
            guard e.name == "questions_written", case .string(let id)? = e.props?["lessonId"], id == lessonId,
                  case .string(let src)? = e.props?["source"] else { return false }
            return src == "device" || src == "server"
        }
    }
}

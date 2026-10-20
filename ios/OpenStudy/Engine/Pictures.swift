import Foundation

/// Picture cards (spec 11.2): photos, whiteboards and diagrams recalled from the image itself.
/// Mirrors web/src/engine/pictures.ts.
public enum PictureCards {
    public static let perLesson = 12
    public static let lessonTitle = "Pictures"
    public static let maxPerSession = 3

    /// Photos, and screenshots with little text (a diagram in a book).
    public static func isPicturePage(_ p: Page) -> Bool {
        guard !(p.image ?? "").isEmpty else { return false }
        if p.kind == "photo" { return true }
        return p.kind == "screenshot" && TextKit.wordCount(p.text) < 40
    }

    public static func draft(_ p: Page) -> BuiltPicture? {
        let text = p.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let heading = p.heading?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let body = text.isEmpty ? heading : text
        guard !body.isEmpty else { return nil }
        return BuiltPicture(pageId: p.id, statement: TextKit.truncate(body, 280),
                            question: heading.isEmpty ? "What does this page show?" : "What's on this page about \(heading)?")
    }

    static func stems(_ s: String) -> [String] { WebText.tokens(s).map(\.stem) }

    /// One picture card per picture page. It joins the lesson that already has cards from its page,
    /// else the lesson closest by TF-IDF cosine, else a "Pictures" lesson. Max 12 per lesson.
    public static func attach(_ result: BuildResult, pages: [Page]) -> BuildResult {
        let drafts = pages.filter(isPicturePage).compactMap(draft)
        guard !drafts.isEmpty else { return result }
        let byId = Dictionary(pages.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var lessons = result.lessons
        let docs = lessons.map { $0.cards.flatMap { stems($0.statement) } }
            + drafts.map { d in stems([byId[d.pageId]?.heading ?? "", byId[d.pageId]?.text ?? ""].joined(separator: "\n")) }
        let vecs = WebText.tfidf(docs)
        var extra: [BuiltLesson] = []
        for (i, d) in drafts.enumerated() {
            var target = lessons.firstIndex { $0.cards.contains { $0.pageId == d.pageId } } ?? -1
            if target < 0 {
                var best = 0.0
                for li in lessons.indices {
                    let c = vecs[lessons.count + i].cosine(vecs[li])
                    if c > best { best = c; target = li }
                }
            }
            if target >= 0 && lessons[target].pictures.count < perLesson {
                lessons[target].pictures.append(d)
                continue
            }
            if extra.isEmpty || extra[extra.count - 1].pictures.count >= perLesson {
                let title = extra.isEmpty ? lessonTitle : "\(lessonTitle) \(extra.count + 1)"
                extra.append(BuiltLesson(title: title, summary: "The photos and diagrams you saved.", cards: []))
            }
            extra[extra.count - 1].pictures.append(d)
        }
        return BuildResult(lessons: lessons + extra, quotes: result.quotes)
    }
}

/// Profile screen numbers and the subscription status line (spec 11.3). Mirrors web/src/engine/profile.ts.
public struct Entitlement: Equatable {
    /// "trialing" | "active" | "past_due" | "canceled" | "expired" | "comp" | "none"
    public var active: Bool
    public var status: String
    public var source: String?
    public var renewsAt: Date?
    public var trialEndsAt: Date?

    public init(active: Bool, status: String, source: String? = nil, renewsAt: Date? = nil, trialEndsAt: Date? = nil) {
        self.active = active; self.status = status; self.source = source; self.renewsAt = renewsAt; self.trialEndsAt = trialEndsAt
    }
}

public struct ProfileStats: Equatable {
    public var xp: Int
    public var streak: Int
    public var longestStreak: Int
    public var projects: Int
    public var cardsLearned: Int
    public var sessions: Int
    public var memberSince: Date?
}

public enum ProfileInfo {
    public static func stats(_ lib: Library, now: Date = Date()) -> ProfileStats {
        let first = lib.events.map(\.t).min()
        return ProfileStats(xp: lib.stats.xp,
                            streak: ProgressEngine.displayStreak(lib.stats, now: now),
                            longestStreak: lib.stats.longestStreak,
                            projects: lib.projects.filter { !($0.sample ?? false) }.count,
                            cardsLearned: lib.cards.filter { $0.srs.reps >= 1 }.count,
                            sessions: lib.events.filter { $0.name == "session_done" }.count,
                            memberSince: first.flatMap(ISO.date))
    }

    static func shortDate(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "MMM d"
        return f.string(from: d)
    }

    /// "Free trial: 5 days left", "OpenStudy Plus, renews Nov 20", "Free for you" or "Not subscribed".
    public static func subscriptionLine(_ e: Entitlement, now: Date = Date()) -> String {
        switch e.status {
        case "comp": return "Free for you"
        case "trialing" where e.trialEndsAt != nil:
            let days = max(0, Int((e.trialEndsAt!.timeIntervalSince(now) / 86_400).rounded(.up)))
            return "Free trial: \(days) \(days == 1 ? "day" : "days") left"
        case "active": return e.renewsAt.map { "OpenStudy Plus, renews \(shortDate($0))" } ?? "OpenStudy Plus"
        case "past_due": return "OpenStudy Plus, payment needs attention"
        case "canceled" where (e.renewsAt ?? .distantPast) > now: return "OpenStudy Plus until \(shortDate(e.renewsAt!))"
        default: return "Not subscribed"
        }
    }

    /// First letter of the name, else of the email, else nil (show a person icon).
    public static func avatarInitial(name: String?, email: String?) -> String? {
        let n = name?.trimmingCharacters(in: .whitespaces) ?? ""
        let src = n.isEmpty ? (email?.trimmingCharacters(in: .whitespaces) ?? "") : n
        return src.first.map { String($0).uppercased() }
    }
}

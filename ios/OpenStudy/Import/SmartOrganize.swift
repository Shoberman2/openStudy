import Foundation
import UIKit

/// Client for the web app's optional Claude routes (spec 3.4). Every failure returns nil/false so
/// callers fall back to the offline engine silently.
struct SmartOrganizeClient {
    let base: URL

    init?(base raw: String) {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.lowercased().hasPrefix("http") { s = "https://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        guard let u = URL(string: s) else { return nil }
        base = u
    }

    fileprivate func request(_ path: String, body: Encodable? = nil, timeout: TimeInterval) throws -> URLRequest {
        var r = URLRequest(url: base.appendingPathComponent(path))
        r.timeoutInterval = timeout
        if let body {
            r.httpMethod = "POST"
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }
        return r
    }

    fileprivate func send<T: Decodable>(_ r: URLRequest, as: T.Type) async -> T? {
        guard let (data, resp) = try? await URLSession.shared.data(for: r),
              let http = resp as? HTTPURLResponse, http.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    func health() async -> Bool {
        struct H: Decodable { var ai: Bool }
        guard let r = try? request("api/health", timeout: 8) else { return false }
        return await send(r, as: H.self)?.ai ?? false
    }

    /// Claude vision read of an image (handwriting, diagrams). nil on any failure: callers fall back to Vision.
    func read(_ image: UIImage) async -> (text: String, heading: String?)? {
        struct Body: Encodable { var image: String; var mediaType: String }
        struct Resp: Decodable { var text: String; var heading: String? }
        guard let jpeg = image.scaledDown(maxSide: 1600).jpegData(compressionQuality: 0.8) else { return nil }
        guard let r = try? request("api/read", body: Body(image: jpeg.base64EncodedString(), mediaType: "image/jpeg"), timeout: 90),
              let resp = await send(r, as: Resp.self), TextKit.wordCount(resp.text) > 0 else { return nil }
        return (resp.text, resp.heading)
    }

    struct SortPage: Encodable { var id: String; var header: String?; var text: String }
    struct SortGroup: Decodable { var title: String; var author: String?; var pageIds: [String] }

    func sort(_ pages: [Page]) async -> [SuggestedGroup]? {
        struct Body: Encodable { var pages: [SortPage] }
        struct Resp: Decodable { var groups: [SortGroup] }
        let body = Body(pages: pages.map { SortPage(id: $0.id, header: $0.header ?? $0.suggestedTitle, text: String($0.text.prefix(700))) })
        guard let r = try? request("api/sort", body: body, timeout: 90), let resp = await send(r, as: Resp.self) else { return nil }
        let valid = Set(pages.map(\.id))
        var seen = Set<String>()
        var groups = resp.groups.compactMap { g -> SuggestedGroup? in
            let ids = g.pageIds.filter { valid.contains($0) && seen.insert($0).inserted }
            return ids.isEmpty ? nil : SuggestedGroup(title: g.title, author: g.author, pageIds: ids)
        }
        let missing = pages.map(\.id).filter { !seen.contains($0) }
        if !missing.isEmpty { groups.append(SuggestedGroup(title: Grouper.unsorted, pageIds: missing)) }
        return groups.isEmpty ? nil : groups
    }

    struct BuildCardDTO: Decodable { var pageId: String?; var statement: String; var cloze: String?; var question: String?; var answer: String?; var distractors: [String]?; var falseStatement: String?; var concept: String? }
    struct BuildLessonDTO: Decodable { var title: String; var summary: String?; var cards: [BuildCardDTO] }
    struct BuildQuoteDTO: Decodable { var pageId: String?; var text: String; var attribution: String? }

    /// Chunks large projects (about 60 pages per call) and merges lessons by title.
    func build(title: String, author: String?, type: String? = nil, pages: [Page], profile: Profile, wantQuotes: Bool) async -> BuildResult? {
        struct ProjectDTO: Encodable { var title: String; var author: String?; var type: String? }
        struct PageDTO: Encodable { var id: String; var text: String }
        struct ProfileDTO: Encodable { var goals: [String]; var practice: [String]; var dailyGoalXP: Int }
        struct Body: Encodable { var project: ProjectDTO; var pages: [PageDTO]; var profile: ProfileDTO; var wantQuotes: Bool }
        struct Resp: Decodable { var lessons: [BuildLessonDTO]; var quotes: [BuildQuoteDTO]? }

        var lessons: [BuiltLesson] = []
        var quotes: [BuiltQuote] = []
        let chunks = stride(from: 0, to: pages.count, by: 60).map { Array(pages[$0..<min(pages.count, $0 + 60)]) }
        for chunk in chunks {
            let body = Body(project: ProjectDTO(title: title, author: author, type: type), pages: chunk.map { PageDTO(id: $0.id, text: $0.text) },
                            profile: ProfileDTO(goals: profile.goals, practice: profile.practice, dailyGoalXP: profile.dailyGoalXP), wantQuotes: wantQuotes)
            guard let r = try? request("api/build", body: body, timeout: 180), let resp = await send(r, as: Resp.self) else { return nil }
            for l in resp.lessons {
                let cards = l.cards.compactMap { c -> BuiltCard? in
                    guard let cloze = c.cloze, !cloze.isEmpty else { return nil }
                    return BuiltCard(pageId: c.pageId, statement: c.statement, cloze: cloze,
                                     question: c.question ?? LessonBuilder.replaceFirst(in: c.statement, cloze, with: "____"),
                                     answer: c.answer ?? cloze, distractors: Array((c.distractors ?? []).prefix(3)),
                                     falseStatement: c.falseStatement ?? c.statement,
                                     concept: (c.concept ?? "").trimmingCharacters(in: .whitespaces).isEmpty ? nil : c.concept)
                }
                if let i = lessons.firstIndex(where: { $0.title.lowercased() == l.title.lowercased() }) {
                    lessons[i].cards += cards
                } else {
                    lessons.append(BuiltLesson(title: l.title, summary: l.summary ?? "", cards: cards))
                }
            }
            quotes += (resp.quotes ?? []).map { BuiltQuote(pageId: $0.pageId, text: $0.text, attribution: $0.attribution ?? author) }
        }
        lessons = lessons.filter { !$0.cards.isEmpty }
        return lessons.isEmpty ? nil : BuildResult(lessons: lessons, quotes: Array(quotes.prefix(20)))
    }
}

extension SmartOrganizeClient {
    /// Learner-friendly definitions for word-list terms (spec 10.2), 80 per call. Keys are lowercased terms.
    func define(_ words: [String]) async -> [String: String]? {
        struct Body: Encodable { var words: [String] }
        struct Def: Decodable { var term: String; var definition: String }
        struct Resp: Decodable { var definitions: [Def] }
        var out: [String: String] = [:]
        for start in stride(from: 0, to: words.count, by: 80) {
            let chunk = Array(words[start..<min(words.count, start + 80)])
            guard let r = try? request("api/define", body: Body(words: chunk), timeout: 90), let resp = await send(r, as: Resp.self) else {
                return out.isEmpty ? nil : out
            }
            for d in resp.definitions where !d.definition.trimmingCharacters(in: .whitespaces).isEmpty { out[d.term.lowercased()] = d.definition }
        }
        return out
    }

    struct AskResult { var answer: String; var grounded: Bool; var citations: [AskQuote] }

    /// Answer from the retrieved pages with verbatim citations (spec 10.7). nil on any failure.
    func ask(_ question: String, pages: [(page: Page, title: String)]) async -> AskResult? {
        struct PageDTO: Encodable { var id: String; var title: String; var text: String }
        struct Body: Encodable { var question: String; var pages: [PageDTO] }
        struct Cite: Decodable { var pageId: String; var quote: String }
        struct Resp: Decodable { var answer: String; var grounded: Bool; var citations: [Cite]? }
        let body = Body(question: question, pages: pages.map { PageDTO(id: $0.page.id, title: $0.title, text: String($0.page.text.prefix(3000))) })
        guard let r = try? request("api/ask", body: body, timeout: 90), let resp = await send(r, as: Resp.self) else { return nil }
        let texts = Dictionary(pages.map { ($0.page.id, $0.page.text) }, uniquingKeysWith: { a, _ in a })
        // The server checks citations; check again so nothing unquoted is shown as a quote.
        let cites = (resp.citations ?? []).compactMap { c -> AskQuote? in
            guard let t = texts[c.pageId], AskEngine.isVerbatim(c.quote, in: t) else { return nil }
            return AskQuote(text: c.quote, pageId: c.pageId)
        }
        return AskResult(answer: resp.answer, grounded: resp.grounded && !cites.isEmpty, citations: cites)
    }
}

private struct AnyEncodable: Encodable {
    let value: Encodable
    init(_ v: Encodable) { value = v }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

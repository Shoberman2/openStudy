import Foundation

// MARK: - Written concept questions (spec 13.6)

/// One card a writer sends to the model: its id and statement.
public struct WriterCard: Codable, Equatable, Hashable {
    public var id: String
    public var text: String
    public init(id: String, text: String) { self.id = id; self.text = text }
}

/// One card the model wrote. Fields are optional so a partial answer from the server still decodes.
public struct WrittenConcept: Codable, Equatable, Hashable {
    public var id: String
    public var concept: String?
    public var question: String?
    public var answer: String?
    public var distractors: [String]?
    public var falseStatement: String?

    public init(id: String, concept: String? = nil, question: String? = nil, answer: String? = nil, distractors: [String]? = nil, falseStatement: String? = nil) {
        self.id = id; self.concept = concept; self.question = question; self.answer = answer
        self.distractors = distractors; self.falseStatement = falseStatement
    }
}

/// Pure rules for when a lesson needs written questions, what goes in, and how results are applied.
/// The writers themselves (on-device model, server) live outside the engine.
public enum WrittenConcepts {
    public static let maxInput = 14
    public static let timeLimit: TimeInterval = 25

    /// Fact cards: no term, no pictures, no quotes.
    static func factCards(_ lib: Library, _ lessonId: String) -> [Card] {
        lib.cards(of: lessonId).filter { $0.kind == "fact" && ($0.term ?? "").isEmpty }
    }

    /// A theme lesson that is not a word lesson, has not been written yet, and where fewer than half of
    /// its fact cards are concept cards.
    public static func needsWrittenConcepts(_ lib: Library, lessonId: String) -> Bool {
        guard let lesson = lib.lessons.first(where: { $0.id == lessonId }), lesson.kind == "theme", lesson.conceptsWritten != true else { return false }
        // A word lesson (every card has a term) has no fact cards, so it never asks.
        let facts = factCards(lib, lessonId)
        guard !facts.isEmpty else { return false }
        return facts.filter(\.isConcept).count * 2 < facts.count
    }

    /// The lesson's fact cards as `{id, text}`, at most 14.
    public static func writerInput(_ lib: Library, lessonId: String) -> [WriterCard] {
        factCards(lib, lessonId).prefix(maxInput).map { WriterCard(id: $0.id, text: $0.statement) }
    }

    static func clean(_ s: String?) -> String { (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Applies written cards to the lesson's input cards. A card needs a question, an answer and 3
    /// distractors that differ from the answer and each other. Ids and SRS stay; others stay unchanged.
    /// Always marks the lesson written and logs `questions_written {source, count, lessonId}`.
    public static func applyWrittenConcepts(_ lib: Library, lessonId: String, written: [WrittenConcept], source: String, now: Date = Date()) -> Library {
        var out = lib
        let inputIds = Set(writerInput(lib, lessonId: lessonId).map(\.id))
        var updated = Set<String>()
        for w in written where inputIds.contains(w.id) && !updated.contains(w.id) {
            let question = clean(w.question), answer = clean(w.answer)
            guard !question.isEmpty, !answer.isEmpty, let i = out.cards.firstIndex(where: { $0.id == w.id }) else { continue }
            let key = AnswerChecker.normalize(answer)
            var seen: Set<String> = [key]
            var wrong: [String] = []
            for d in (w.distractors ?? []).map(clean) where !d.isEmpty && wrong.count < 3 {
                if seen.insert(AnswerChecker.normalize(d)).inserted { wrong.append(d) }
            }
            guard wrong.count == 3 else { continue }
            let concept = clean(w.concept)
            if !concept.isEmpty { out.cards[i].concept = concept }
            out.cards[i].question = question
            out.cards[i].answer = answer
            out.cards[i].distractors = wrong
            let falseStatement = clean(w.falseStatement)
            if !falseStatement.isEmpty { out.cards[i].falseStatement = falseStatement }
            updated.insert(w.id)
        }
        if let li = out.lessons.firstIndex(where: { $0.id == lessonId }) { out.lessons[li].conceptsWritten = true }
        out.log("questions_written", ["source": .string(source), "count": .number(Double(updated.count)), "lessonId": .string(lessonId)], now: now)
        return out
    }
}

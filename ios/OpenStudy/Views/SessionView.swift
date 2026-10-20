import SwiftUI

enum Answer: Equatable {
    case choice(String)
    case words([String?])
    case text(String)
    case order([String])
    case match(mistakes: Int)
    case flash(Grade)
}

struct Feedback: Equatable {
    var result: CheckResult
    var exercise: Exercise
    var given: Answer
}

struct SessionView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    let launch: SessionLaunch

    @State private var state: SessionState
    @State private var answer: Answer?
    @State private var feedback: Feedback?
    @State private var summary: SessionSummary?
    @State private var started = Date()
    @State private var exerciseStarted = Date()
    @State private var confirmQuit = false
    @State private var shake: CGFloat = 0
    @State private var pop = false
    @State private var sourcePage: Page?
    @FocusState private var typing: Bool

    init(launch: SessionLaunch) {
        self.launch = launch
        _state = State(initialValue: SessionState(exercises: launch.exercises, requeue: !launch.isTest))
    }

    var project: Project? { store.project(launch.projectId) }

    var body: some View {
        Group {
            if let summary, let test = summary.test {
                TestResultView(summary: summary, result: test, onMisses: { ids in
                    dismiss()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { store.startMisses(ids, projectId: summary.projectId) }
                }, onDone: { dismiss() })
                .transition(.opacity)
            } else if let summary {
                CompletionView(summary: summary, title: launch.title) { dismiss() }
                    .transition(.opacity)
            } else if let ex = state.current {
                VStack(spacing: 0) {
                    topBar
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            Text(ex.instruction)
                                .font(Typo.title)
                                .foregroundStyle(Palette.ink)
                                .fixedSize(horizontal: false, vertical: true)
                            if launch.isTest {
                                Text("Question \(state.index + 1) of \(state.total). Results at the end.")
                                    .font(Typo.small).foregroundStyle(Palette.muted)
                            }
                            if ex.isRetry {
                                Label("Try this one again", systemImage: "arrow.uturn.backward")
                                    .font(Typo.small).foregroundStyle(Palette.redText)
                            }
                            ExerciseView(exercise: ex, locked: feedback != nil, feedback: feedback, answer: $answer, typing: $typing,
                                         onAutoSubmit: { a in answer = a; check() })
                                .id(ex.id)
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 14)
                        .padding(.bottom, 24)
                        .scaleEffect(pop ? 1.04 : 1)
                        .modifier(Shake(animatableData: shake))
                    }
                    .scrollDismissesKeyboard(.interactively)
                    bottomBar(ex)
                }
                .transition(.opacity)
            }
        }
        .background(Palette.paper.ignoresSafeArea())
        .confirmationDialog("Quit this lesson?", isPresented: $confirmQuit, titleVisibility: .visible) {
            Button("Quit", role: .destructive) { dismiss() }
            Button("Keep going", role: .cancel) {}
        } message: { Text("You will lose the XP from this session.") }
        .sheet(item: $sourcePage) { PageDetail(page: $0) }
        .onAppear {
            started = Date(); exerciseStarted = Date()
            #if DEBUG
            if let mode = DebugLaunch.autoAnswer { DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { debugAnswer(mode) } }
            if DebugLaunch.screen == "complete" || DebugLaunch.screen == "testresult" { DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { debugComplete() } }
            #endif
        }
    }

    // MARK: Top bar

    var topBar: some View {
        HStack(spacing: 12) {
            IconButton(systemName: "xmark", label: "Close lesson") { confirmQuit = true }
            ProgressBar(value: state.progress, color: Palette.green)
            HStack(spacing: 3) {
                Image(systemName: "flame.fill").font(.system(size: 18, weight: .bold))
                Text("\(state.combo)").font(Typo.rounded(17, .heavy)).monospacedDigit()
            }
            .foregroundStyle(Palette.yellow)
            .frame(width: 44)
            .opacity(state.combo >= 3 ? 1 : 0)
            .scaleEffect(state.combo >= 3 ? 1 : 0.6)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: state.combo)
            .accessibilityLabel("\(state.combo) in a row")
            .accessibilityHidden(state.combo < 3)
        }
        .padding(.horizontal, 8)
        .padding(.trailing, 6)
        .frame(height: 56)
    }

    // MARK: Bottom: Check button or feedback panel

    @ViewBuilder
    func bottomBar(_ ex: Exercise) -> some View {
        if let fb = feedback {
            FeedbackPanel(feedback: fb, bookTitle: project?.title ?? store.project(store.library.cards.first { $0.id == fb.exercise.cardId }?.projectId)?.title,
                          onSource: { openSource(fb.exercise) }, onContinue: next)
                .transition(reduceMotion ? .opacity : .move(edge: .bottom))
        } else if ex.kind == .flash || ex.kind == .match || ex.kind == .explain || ex.kind == .picture {
            Color.clear.frame(height: 20)
        } else {
            VStack(spacing: 0) {
                Rectangle().fill(Palette.line).frame(height: 2)
                Button(launch.isTest ? "Next" : "Check") { check() }
                    .buttonStyle(.chunky(.green))
                    .disabled(!isReady(ex))
                    .padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 8)
            }
        }
    }

    func isReady(_ ex: Exercise) -> Bool {
        switch answer {
        case .none: return false
        case .choice: return true
        case .words(let w): return w.allSatisfy { $0 != nil }
        case .text(let t): return !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .order(let o): return o.count == ex.chunks.count
        case .match, .flash: return true
        }
    }

    // MARK: Checking

    static func evaluate(_ ex: Exercise, _ a: Answer) -> CheckResult {
        switch (ex.kind, a) {
        case (.mc, .choice(let c)), (.tf, .choice(let c)):
            return c == ex.answer ? .correct : .wrong
        case (_, .words(let ws)):
            let ok = zip(ws, ex.blanks).allSatisfy { ($0 ?? "").lowercased() == $1.lowercased() }
            return ok ? .correct : .wrong
        case (.apply, .text(let t)):
            return TextKit.wordCount(t) >= 4 ? .correct : .wrong
        case (.qLetters, .text(let t)), (.qRecall, .text(let t)):
            return AnswerChecker.checkQuote(t, against: ex.answer)
        case (_, .text(let t)):
            return AnswerChecker.check(t, against: ex.answer)
        case (.qOrder, .order(let o)):
            return o == ex.chunks ? .correct : .wrong
        case (_, .match(let m)):
            return m == 0 ? .correct : m == 1 ? .close : .wrong
        case (.termType, .text(let t)):
            return AnswerChecker.check(t, against: ex.answer)
        case (.defMc, .choice(let c)):
            return c == ex.answer ? .correct : .wrong
        case (_, .flash(let g)):
            return g == .again ? .wrong : g == .hard ? .close : .correct
        default:
            return .wrong
        }
    }

    func check() {
        guard feedback == nil, let ex = state.current, let a = answer else { return }
        typing = false
        let result = Self.evaluate(ex, a)
        let seconds = Date().timeIntervalSince(exerciseStarted)
        var flashGrade: Grade?
        if case .flash(let g) = a { flashGrade = g }
        let grades = state.submit(result, seconds: seconds, flashGrade: flashGrade)
        store.grade(grades)
        if launch.isTest {
            Haptics.tap()
        } else if result.passes {
            Haptics.success()
            if !reduceMotion {
                withAnimation(.easeOut(duration: 0.12)) { pop = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.14) { withAnimation(.easeOut(duration: 0.16)) { pop = false } }
            }
        } else {
            Haptics.error()
            if !reduceMotion { withAnimation(.linear(duration: 0.4)) { shake += 1 } }
        }
        if ex.kind == .flash || ex.kind == .explain || ex.kind == .picture || launch.isTest {
            // Self graded, or a practice test (no feedback until the end).
            next()
            return
        }
        withAnimation(Motion.slide) { feedback = Feedback(result: result, exercise: ex, given: a) }
    }

    func next() {
        state.advance()
        answer = nil
        exerciseStarted = Date()
        withAnimation(Motion.slide) { feedback = nil }
        if state.isFinished {
            let s = store.finish(launch, state: state, seconds: Int(Date().timeIntervalSince(started)))
            withAnimation(Motion.slide) { summary = s }
        }
    }

    func openSource(_ ex: Exercise) {
        guard let card = store.library.cards.first(where: { $0.id == ex.cardId }), let pid = card.pageId,
              let page = store.library.pages.first(where: { $0.id == pid }) else { return }
        sourcePage = page
    }

    #if DEBUG
    func debugAnswer(_ mode: String) {
        guard let ex = state.current else { return }
        let right = mode != "wrong"
        switch ex.kind {
        case .mc, .tf, .defMc:
            answer = .choice(right ? ex.answer : (ex.options.first { $0 != ex.answer } ?? ""))
        case .explain, .picture:
            return
        case .bank, .qBank1, .qBank3:
            answer = .words(right ? ex.blanks : ex.blanks.map { _ in ex.options.first { o in !ex.blanks.contains(o) } ?? "x" })
        case .qOrder:
            answer = .order(right ? ex.chunks : ex.chunks.reversed())
        case .match:
            answer = .match(mistakes: right ? 0 : 2)
        case .flash:
            answer = .flash(right ? .good : .again)
        default:
            answer = .text(right ? ex.answer : (ex.kind == .termType ? "Ribosome" : "The best way to win is to keep arguing"))
        }
        check()
    }

    func debugComplete() {
        var i = 0
        while let _ = state.current { state.submit(launch.isTest && i % 3 == 1 ? .wrong : .correct, seconds: 4); state.advance(); i += 1 }
        summary = store.finish(launch, state: state, seconds: 154)
    }
    #endif
}

// MARK: - Feedback panel

struct FeedbackPanel: View {
    let feedback: Feedback
    let bookTitle: String?
    var onSource: () -> Void
    var onContinue: () -> Void

    var body: some View {
        let ok = feedback.result.passes
        let ex = feedback.exercise
        let tint = ok ? Palette.greenText : Palette.redText
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .font(.system(size: 26, weight: .bold))
                Text(headline).font(Typo.title)
            }
            .foregroundStyle(tint)
            detail(ex, ok: ok, tint: tint)
            SourceThumb(cardId: ex.cardId)
            if let bookTitle {
                Button(action: onSource) {
                    HStack(spacing: 6) {
                        Image(systemName: "book.closed").font(.system(size: 13, weight: .bold))
                        Text("From \(bookTitle)").lineLimit(1)
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                    }
                    .font(Typo.rounded(14, .bold))
                    .foregroundStyle(tint.opacity(0.85))
                }
                .accessibilityHint("Shows the source page")
            }
            Button("Continue", action: onContinue)
                .buttonStyle(.chunky(ok ? .green : .red))
                .padding(.top, 4)
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background((ok ? Palette.greenSoft : Palette.redSoft).ignoresSafeArea(edges: .bottom))
    }

    var headline: String {
        switch feedback.result {
        case .correct: return feedback.exercise.kind == .apply ? "Nice, that counts" : "Correct"
        case .close: return "Almost"
        case .wrong: return "Not quite"
        }
    }

    @ViewBuilder
    func detail(_ ex: Exercise, ok: Bool, tint: Color) -> some View {
        let isQuoteTyped = ex.kind == .qLetters || ex.kind == .qRecall
        if isQuoteTyped, case .text(let given) = feedback.given, feedback.result != .correct {
            VStack(alignment: .leading, spacing: 6) {
                Text("Word for word:").font(Typo.small).foregroundStyle(tint)
                DiffText(tokens: AnswerChecker.diff(given, ex.answer))
            }
        } else if feedback.result == .close, ex.kind == .type, case .text = feedback.given {
            Text("Watch the spelling: \(ex.answer)").font(Typo.bodyBold).foregroundStyle(tint)
        } else if feedback.result == .close, ex.kind == .match {
            Text("One pair took a second try.").font(Typo.bodyBold).foregroundStyle(tint)
        } else if !ok {
            VStack(alignment: .leading, spacing: 4) {
                Text("Correct answer:").font(Typo.small).foregroundStyle(tint)
                Text(correctText(ex))
                    .font(ex.kind.isQuote || ex.kind == .tf ? Typo.serif(18, .medium) : Typo.bodyBold)
                    .foregroundStyle(tint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    func correctText(_ ex: Exercise) -> String {
        switch ex.kind {
        case .tf: return ex.tfIsTrue ? "True. That is what the book says." : "False. The book says: \(ex.hint ?? "")"
        case .bank: return ex.blanks.joined(separator: ", ")
        case .qOrder, .qBank1, .qBank3: return ex.answer
        case .match: return "Matching takes practice. These pairs will come back."
        default: return ex.answer
        }
    }
}

/// Quote diff: missing words in red, extra words struck through.
struct DiffText: View {
    let tokens: [DiffToken]
    var body: some View {
        tokens.reduce(Text("")) { acc, t in
            let piece: Text
            switch t.kind {
            case .same: piece = Text(t.word + " ").foregroundColor(Palette.ink)
            case .missing: piece = Text(t.word + " ").foregroundColor(Palette.red).bold().underline()
            case .extra: piece = Text(t.word + " ").foregroundColor(Palette.muted).strikethrough()
            }
            return acc + piece
        }
        .font(Typo.serif(18))
        .fixedSize(horizontal: false, vertical: true)
    }
}

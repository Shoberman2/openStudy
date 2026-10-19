import SwiftUI

struct ExerciseView: View {
    let exercise: Exercise
    let locked: Bool
    let feedback: Feedback?
    @Binding var answer: Answer?
    var typing: FocusState<Bool>.Binding
    var onAutoSubmit: (Answer) -> Void

    var body: some View {
        switch exercise.kind {
        case .mc: MCView(ex: exercise, locked: locked, answer: $answer)
        case .defMc: DefMCView(ex: exercise, locked: locked, answer: $answer)
        case .explain: ExplainView(ex: exercise, typing: typing, onRate: { onAutoSubmit(.flash($0)) })
        case .tf: TFView(ex: exercise, locked: locked, answer: $answer)
        case .bank, .qBank1, .qBank3: BankView(ex: exercise, locked: locked, answer: $answer)
        case .type, .apply, .qLetters, .qRecall, .termType: TypeView(ex: exercise, locked: locked, answer: $answer, typing: typing)
        case .qOrder: OrderView(ex: exercise, locked: locked, answer: $answer)
        case .match: MatchView(ex: exercise, locked: locked, onDone: onAutoSubmit)
        case .flash: FlashView(ex: exercise, onGrade: { onAutoSubmit(.flash($0)) })
        }
    }
}

/// The prompt: serif when it is book text (statements, blanks, quotes), rounded when it is a question.
struct PromptText: View {
    let text: String
    var body: some View {
        let bookish = text.contains("____") || !text.hasSuffix("?")
        Text(text)
            .font(bookish ? Typo.serif(22) : Typo.rounded(21, .bold))
            .foregroundStyle(Palette.ink)
            .lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct MCView: View {
    let ex: Exercise
    let locked: Bool
    @Binding var answer: Answer?
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PromptText(text: ex.body)
            VStack(spacing: 10) {
                ForEach(Array(ex.options.enumerated()), id: \.offset) { _, o in
                    Button { Haptics.tap(); answer = .choice(o) } label: { Text(o).frame(maxWidth: .infinity, alignment: .leading) }
                        .buttonStyle(TileStyle(state: state(o)))
                        .disabled(locked)
                }
            }
        }
    }
    func state(_ o: String) -> TileState {
        let chosen = answer == .choice(o)
        if locked {
            if o == ex.answer { return .correct }
            return chosen ? .wrong : .normal
        }
        return chosen ? .selected : .normal
    }
}

struct TFView: View {
    let ex: Exercise
    let locked: Bool
    @Binding var answer: Answer?
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(ex.body)
                .font(Typo.serif(22))
                .foregroundStyle(Palette.ink)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.shelf))
            HStack(spacing: 12) {
                ForEach(["True", "False"], id: \.self) { o in
                    Button { Haptics.tap(); answer = .choice(o) } label: {
                        Label(o, systemImage: o == "True" ? "checkmark" : "xmark").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(TileStyle(state: state(o), minHeight: 64, alignment: .center))
                    .disabled(locked)
                }
            }
        }
    }
    func state(_ o: String) -> TileState {
        let chosen = answer == .choice(o)
        if locked { return o == ex.answer ? .correct : (chosen ? .wrong : .normal) }
        return chosen ? .selected : .normal
    }
}

// MARK: Word bank (facts and quotes)

struct BankView: View {
    let ex: Exercise
    let locked: Bool
    @Binding var answer: Answer?
    @State private var filled: [Int?] = []   // blank index -> option index

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            FlowLayout(spacing: 6, lineSpacing: 12) {
                ForEach(Array(ex.segments.enumerated()), id: \.offset) { _, seg in
                    switch seg {
                    case .text(let w):
                        Text(w).font(Typo.serif(21)).foregroundStyle(Palette.ink)
                    case .blank(let k, let suffix):
                        HStack(spacing: 1) {
                            blank(k)
                            if !suffix.isEmpty { Text(suffix).font(Typo.serif(21)).foregroundStyle(Palette.ink) }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
            if ex.kind.isQuote, let a = ex.attribution {
                Text(a).font(Typo.small).foregroundStyle(Palette.muted).padding(.top, -14)
            }
            Rectangle().fill(Palette.line).frame(height: 2)
            FlowLayout(spacing: 10, lineSpacing: 12, alignment: .center) {
                ForEach(Array(ex.options.enumerated()), id: \.offset) { i, o in
                    let used = filled.contains(i)
                    Button { tapOption(i) } label: { Text(o) }
                        .buttonStyle(ChipStyle(state: used ? .disabled : .normal))
                        .opacity(used ? 0.35 : 1)
                        .disabled(used || locked)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .onAppear { if filled.count != ex.blanks.count { filled = Array(repeating: nil, count: ex.blanks.count) } }
        .onChange(of: answer) { _, a in
            // Reflect answers set from outside (debug autoanswer) in the blanks.
            guard case .words(let ws) = a, ws != filled.map({ $0.map { ex.options[$0] } }) else { return }
            var used = Set<Int>()
            filled = ws.map { w in
                guard let w, let i = ex.options.indices.first(where: { ex.options[$0] == w && !used.contains($0) }) else { return nil }
                used.insert(i); return i
            }
        }
    }

    @ViewBuilder func blank(_ k: Int) -> some View {
        if k < filled.count, let oi = filled[k] {
            Button { if !locked { filled[k] = nil; sync() } } label: { Text(ex.options[oi]) }
                .buttonStyle(ChipStyle(state: chipState(k, oi)))
        } else {
            VStack(spacing: 0) {
                Spacer()
                Rectangle().fill(Palette.lineStrong).frame(height: 2)
            }
            .frame(width: max(64, CGFloat(ex.blanks[k].count) * 11), height: 40)
        }
    }

    func chipState(_ k: Int, _ oi: Int) -> TileState {
        guard locked else { return .selected }
        return ex.options[oi].lowercased() == ex.blanks[k].lowercased() ? .correct : .wrong
    }

    func tapOption(_ i: Int) {
        guard let k = filled.firstIndex(where: { $0 == nil }) else { return }
        Haptics.tap()
        filled[k] = i
        sync()
    }

    func sync() { answer = .words(filled.map { $0.map { ex.options[$0] } }) }
}

// MARK: Typing (type, apply, quote letters, quote recall)

struct TypeView: View {
    let ex: Exercise
    let locked: Bool
    @Binding var answer: Answer?
    var typing: FocusState<Bool>.Binding
    @State private var text = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            switch ex.kind {
            case .qLetters:
                Text(ex.hint ?? "")
                    .font(.system(size: 21, weight: .regular, design: .serif))
                    .foregroundStyle(Palette.ink)
                    .lineSpacing(6)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.shelf))
                if let a = ex.attribution { Text(a).font(Typo.small).foregroundStyle(Palette.muted) }
            case .qRecall:
                VStack(alignment: .leading, spacing: 6) {
                    Text(ex.attribution ?? "").font(Typo.headline).foregroundStyle(Palette.ink)
                    Text("Starts with \u{201C}\(ex.hint ?? "")\u{201D}").font(Typo.serif(18)).foregroundStyle(Palette.muted)
                }
            case .termType:
                Text(ex.body)
                    .font(Typo.serif(21)).foregroundStyle(Palette.ink).lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.shelf))
            case .apply:
                Text(ex.body)
                    .font(Typo.serif(21)).foregroundStyle(Palette.ink).lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.shelf))
            default:
                PromptText(text: ex.body)
            }
            TextField(placeholder, text: $text, axis: .vertical)
                .font(ex.kind == .type || ex.kind == .termType ? Typo.rounded(19, .semibold) : Typo.serif(19))
                .lineLimit(ex.kind == .type || ex.kind == .termType ? 1...3 : 3...8)
                .textInputAutocapitalization(ex.kind == .type || ex.kind == .termType ? .never : .sentences)
                .autocorrectionDisabled(ex.kind != .apply)
                .focused(typing)
                .disabled(locked)
                .padding(16)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.shelf))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(locked ? border : Palette.line, lineWidth: 2))
                .onChange(of: text) { _, t in answer = .text(t) }
                .onChange(of: answer) { _, a in if case .text(let t) = a, t != text { text = t } }
        }
        .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { typing.wrappedValue = true } }
    }

    var border: Color {
        guard let a = answer else { return Palette.line }
        return SessionView.evaluate(ex, a).passes ? Palette.green : Palette.red
    }

    var placeholder: String {
        switch ex.kind {
        case .apply: return "Write one way you would use this"
        case .qLetters, .qRecall: return "Type the full quote"
        case .termType: return "The term"
        default: return "Your answer"
        }
    }
}

// MARK: Quote order

struct OrderView: View {
    let ex: Exercise
    let locked: Bool
    @Binding var answer: Answer?
    @State private var chosen: [Int] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            if let a = ex.attribution { Text(a).font(Typo.small).foregroundStyle(Palette.muted) }
            FlowLayout(spacing: 8, lineSpacing: 10) {
                ForEach(chosen, id: \.self) { i in
                    Button { if !locked { chosen.removeAll { $0 == i }; sync() } } label: {
                        Text(ex.options[i]).font(Typo.serif(18, .medium))
                    }
                    .buttonStyle(ChipStyle(state: locked ? (orderCorrect ? .correct : .wrong) : .selected))
                }
            }
            .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.shelf))
            FlowLayout(spacing: 10, lineSpacing: 12, alignment: .center) {
                ForEach(Array(ex.options.enumerated()), id: \.offset) { i, o in
                    let used = chosen.contains(i)
                    Button { Haptics.tap(); chosen.append(i); sync() } label: { Text(o).font(Typo.serif(18, .medium)) }
                        .buttonStyle(ChipStyle(state: used ? .disabled : .normal))
                        .opacity(used ? 0.35 : 1)
                        .disabled(used || locked)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    var orderCorrect: Bool { chosen.map { ex.options[$0] } == ex.chunks }
    func sync() { answer = .order(chosen.map { ex.options[$0] }) }
}

// MARK: Match (4 pairs)

struct MatchView: View {
    let ex: Exercise
    let locked: Bool
    var onDone: (Answer) -> Void
    @State private var left: Int?
    @State private var right: Int?
    @State private var matched = Set<String>()   // terms matched
    @State private var wrongPair: (Int, Int)?
    @State private var mistakes = 0

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(spacing: 10) {
                ForEach(Array(ex.options.enumerated()), id: \.offset) { i, term in
                    Button { tapLeft(i) } label: { Text(term).lineLimit(1).minimumScaleFactor(0.6).frame(maxWidth: .infinity) }
                        .buttonStyle(TileStyle(state: leftState(i, term), minHeight: 96, alignment: .center))
                        .disabled(matched.contains(term) || locked)
                }
            }
            .frame(width: 128)
            VStack(spacing: 10) {
                ForEach(Array(ex.chunks.enumerated()), id: \.offset) { i, s in
                    Button { tapRight(i) } label: {
                        Text(s).font(Typo.serif(14)).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(TileStyle(state: rightState(i, s), minHeight: 96))
                    .disabled(isMatched(statement: s) || locked)
                }
            }
        }
    }

    func term(for statement: String) -> String? { ex.pairs.first { $0.statement == statement }?.term }
    func isMatched(statement: String) -> Bool { term(for: statement).map(matched.contains) ?? false }

    func leftState(_ i: Int, _ t: String) -> TileState {
        if matched.contains(t) { return .correct }
        if wrongPair?.0 == i { return .wrong }
        return left == i ? .selected : .normal
    }
    func rightState(_ i: Int, _ s: String) -> TileState {
        if isMatched(statement: s) { return .correct }
        if wrongPair?.1 == i { return .wrong }
        return right == i ? .selected : .normal
    }

    func tapLeft(_ i: Int) { Haptics.tap(); left = i; resolve() }
    func tapRight(_ i: Int) { Haptics.tap(); right = i; resolve() }

    func resolve() {
        guard let l = left, let r = right else { return }
        let t = ex.options[l]
        if term(for: ex.chunks[r]) == t {
            withAnimation(Motion.quick) { _ = matched.insert(t) }
            left = nil; right = nil
            if matched.count == ex.pairs.count {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { onDone(.match(mistakes: mistakes)) }
            }
        } else {
            mistakes += 1
            Haptics.error()
            wrongPair = (l, r)
            left = nil; right = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { withAnimation(Motion.quick) { wrongPair = nil } }
        }
    }
}

// MARK: Flashcard (self graded)

struct FlashView: View {
    let ex: Exercise
    var onGrade: (Grade) -> Void
    @State private var revealed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 16) {
                PromptText(text: ex.body)
                if revealed {
                    Rectangle().fill(Palette.line).frame(height: 2)
                    Text(ex.answer).font(Typo.serif(22, .semibold)).foregroundStyle(Palette.blue)
                        .fixedSize(horizontal: false, vertical: true)
                        .transition(.opacity)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, minHeight: 220, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Palette.shelf))
            if revealed {
                Text("How well did you know it?").font(Typo.small).foregroundStyle(Palette.muted)
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    Button("Again") { onGrade(.again) }.buttonStyle(.chunky(.red))
                    Button("Hard") { onGrade(.hard) }.buttonStyle(.chunky(.secondary))
                    Button("Good") { onGrade(.good) }.buttonStyle(.chunky(.green))
                    Button("Easy") { onGrade(.easy) }.buttonStyle(.chunky)
                }
            } else {
                Button("Show answer") { withAnimation(Motion.quick) { revealed = true } }.buttonStyle(.chunky(.secondary))
            }
        }
    }
}

// MARK: Definition multiple choice (term -> definition)

struct DefMCView: View {
    let ex: Exercise
    let locked: Bool
    @Binding var answer: Answer?
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(ex.body)
                .font(Typo.rounded(28, .heavy))
                .foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 10) {
                ForEach(Array(ex.options.enumerated()), id: \.offset) { _, o in
                    Button { Haptics.tap(); answer = .choice(o) } label: {
                        Text(o).font(Typo.serif(17)).frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .buttonStyle(TileStyle(state: state(o)))
                    .disabled(locked)
                }
            }
        }
    }
    func state(_ o: String) -> TileState {
        let chosen = answer == .choice(o)
        if locked { return o == ex.answer ? .correct : (chosen ? .wrong : .normal) }
        return chosen ? .selected : .normal
    }
}

// MARK: Explain (Feynman): write, compare with the source, self rate

struct ExplainView: View {
    let ex: Exercise
    var typing: FocusState<Bool>.Binding
    var onRate: (Grade) -> Void
    @State private var text = ""
    @State private var comparing = false

    var words: Int { TextKit.wordCount(text) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(ex.body)
                .font(Typo.rounded(19, .bold)).foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Start with the main idea, then an example", text: $text, axis: .vertical)
                .font(Typo.serif(18))
                .lineLimit(4...10)
                .focused(typing)
                .disabled(comparing)
                .padding(16)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.shelf))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
            if comparing {
                VStack(alignment: .leading, spacing: 8) {
                    Text("From your notes").font(Typo.small).foregroundStyle(Palette.muted)
                    Text(ex.answer).font(Typo.serif(18)).foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.blueSoft))
                Text("How close were you?").font(Typo.small).foregroundStyle(Palette.muted)
                HStack(spacing: 8) {
                    Button("Got it") { onRate(.good) }.buttonStyle(.chunky(.green, height: 48))
                    Button("Partly") { onRate(.hard) }.buttonStyle(.chunky(.secondary, height: 48))
                    Button("Missed it") { onRate(.again) }.buttonStyle(.chunky(.red, height: 48))
                }
            } else {
                Text(words >= 12 ? "Ready to compare" : "\(max(0, 12 - words)) more \(12 - words == 1 ? "word" : "words") to go")
                    .font(Typo.small).foregroundStyle(words >= 12 ? Palette.greenText : Palette.muted)
                    .monospacedDigit()
                Button("Compare with my notes") { typing.wrappedValue = false; withAnimation(Motion.quick) { comparing = true } }
                    .buttonStyle(.chunky)
                    .disabled(words < 12)
            }
        }
        .onAppear {
            #if DEBUG
            if DebugLaunch.autoAnswer != nil {
                text = "Mitochondria are like tiny power plants inside the cell that turn food into ATP energy the cell can use."
                comparing = true
                return
            }
            #endif
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { typing.wrappedValue = true }
        }
    }
}

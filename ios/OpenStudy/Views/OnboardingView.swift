import SwiftUI
import UniformTypeIdentifiers

struct Choice: Identifiable { let id: String; let title: String; let detail: String?; let icon: String }

enum OnboardingCopy {
    static let bringing = [
        Choice(id: "books", title: "Books I'm reading", detail: "Screenshots and Notes excerpts", icon: "book.closed"),
        Choice(id: "class", title: "Classes", detail: "Slides, PDFs, notes, the whiteboard", icon: "graduationcap"),
        Choice(id: "anything", title: "Anything else", detail: "Docs, articles, manuals", icon: "square.stack"),
    ]
    static let goals = [
        Choice(id: "ideas", title: "Remember the big ideas", detail: nil, icon: "lightbulb"),
        Choice(id: "facts", title: "Know the facts cold", detail: nil, icon: "checkmark.seal"),
        Choice(id: "quotes", title: "Quote it word for word", detail: nil, icon: "quote.opening"),
        Choice(id: "apply", title: "Use it in real life", detail: nil, icon: "figure.walk"),
    ]
    static let practice = [
        Choice(id: "tap", title: "Quick taps", detail: "Multiple choice, true or false, matching", icon: "hand.tap"),
        Choice(id: "blank", title: "Fill in the blank", detail: "Pick the missing word", icon: "text.insert"),
        Choice(id: "type", title: "Type it from memory", detail: "The hardest, the best for recall", icon: "keyboard"),
        Choice(id: "flash", title: "Flashcards", detail: "Flip and grade yourself", icon: "rectangle.on.rectangle"),
    ]
    static let dailyGoals: [(xp: Int, title: String, detail: String)] = [
        (10, "Casual", "5 min a day"), (20, "Regular", "10 min a day"), (30, "Serious", "15 min a day"), (50, "Intense", "20 min a day"),
    ]
}

/// Onboarding is a chat with Ollie (spencer-app-style section 2): one question at a time, tap-only
/// answers, five steps: what you study, what you want, time a day, account, first material.
struct OnboardingView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var importer: Importer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    enum Step: Int, CaseIterable { case bringing, goals, daily, account, material }

    struct Line: Identifiable, Equatable { let id = UUID(); var owl: Bool; var text: String }

    @State private var step: Step = .bringing
    @State private var lines: [Line] = []
    @State private var typing = false
    @State private var profile: Profile = {
        var p = Profile()
        p.bringing = []
        p.goals = []
        p.practice = ["tap", "blank", "type"]
        return p
    }()
    @State private var signingIn = false
    @State private var pasting = false
    @State private var importingFile = false
    @State private var failed = false
    @State private var accountNote: String?
    @State private var tapCount = 0

    static func question(_ step: Step) -> String {
        switch step {
        case .bringing: return "Hi, I'm \(Mascot.name). I turn what you save into short lessons. What are you studying?"
        case .goals: return "Nice. What do you want from it?"
        case .daily: return "How much time a day works for you?"
        case .account: return "Want an account? It keeps your shelf and your subscription safe. You can add one later."
        case .material: return "Last one. What should we start with?"
        }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    OwlView(mood: owlMood, size: 84, blinks: true)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 20)
                        .padding(.bottom, 8)
                    ForEach(lines) { line in
                        bubble(line)
                            .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                    }
                    if typing { TypingBubble().transition(.opacity) }
                    if let accountNote {
                        Text(accountNote).font(Typo.small).foregroundStyle(Palette.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 12)
            }
            .scrollBounceBehavior(.basedOnSize)
            .clipped()
            .onChange(of: lines) { _, _ in withAnimation(Motion.slide) { proxy.scrollTo("end", anchor: .bottom) } }
            .onChange(of: typing) { _, _ in withAnimation(Motion.slide) { proxy.scrollTo("end", anchor: .bottom) } }
        }
        .safeAreaInset(edge: .bottom) {
            answers
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 8)
                .background(Palette.bg)
                .opacity(typing ? 0.4 : 1)
                .disabled(typing)
                .animation(Motion.quick, value: typing)
        }
        .background(Palette.bg.ignoresSafeArea())
        .sensoryFeedback(.selection, trigger: tapCount)
        .onAppear {
            if lines.isEmpty { lines = [Line(owl: true, text: Self.question(.bringing))] }
            #if DEBUG
            if DebugLaunch.value("-onboardingStep") == "account" {
                lines += [Line(owl: false, text: "Books I'm reading"), Line(owl: true, text: Self.question(.goals)),
                          Line(owl: false, text: "Remember the big ideas"), Line(owl: true, text: Self.question(.daily)),
                          Line(owl: false, text: "10 min a day"), Line(owl: true, text: Self.question(.account))]
                step = .account
                if DebugLaunch.args.contains("-openEmail") { signingIn = true }
            }
            #endif
        }
        .sheet(isPresented: $signingIn) {
            SignInView(onDone: {
                signingIn = false
                answer("Signed in", next: .material)
            }, onCancel: { signingIn = false })
            .presentationDetents([.large])
        }
        .sheet(isPresented: $pasting, onDismiss: { if !store.library.inbox.isEmpty { complete(then: .sort) } }) { PasteNotesSheet() }
        .fileImporter(isPresented: $importingFile, allowedContentTypes: [.json]) { result in
            if case .success(let url) = result, store.importLibrary(from: url) {
                complete(then: .home)
            } else { failed = true }
        }
        .alert("That file could not be read", isPresented: $failed) { Button("OK", role: .cancel) {} } message: {
            Text("Pick a library file exported from OpenStudy on the web or on iPhone.")
        }
    }

    var owlMood: OwlView.Mood {
        if typing { return .thinking }
        return step == .material ? .happy : .neutral
    }

    func bubble(_ line: Line) -> some View {
        HStack {
            if !line.owl { Spacer(minLength: 48) }
            Text(line.text)
                .font(Typo.body)
                .foregroundStyle(line.owl ? Palette.ink : Palette.onAccent)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(line.owl ? Palette.surfaceDim : Palette.ink))
                .fixedSize(horizontal: false, vertical: true)
            if line.owl { Spacer(minLength: 48) }
        }
        .accessibilityLabel(line.owl ? "\(Mascot.name): \(line.text)" : "You: \(line.text)")
    }

    // MARK: Answers

    @ViewBuilder var answers: some View {
        switch step {
        case .bringing:
            VStack(spacing: 8) {
                ForEach(OnboardingCopy.bringing) { c in option(c.title, selected: profile.bringing.contains(c.id)) { toggle(&profile.bringing, c.id) } }
                Button("Continue") { answer(titles(OnboardingCopy.bringing, profile.bringing), next: .goals) }
                    .buttonStyle(.pill).disabled(profile.bringing.isEmpty).padding(.top, 4)
            }
        case .goals:
            VStack(spacing: 8) {
                ForEach(OnboardingCopy.goals) { c in option(c.title, selected: profile.goals.contains(c.id)) { toggle(&profile.goals, c.id) } }
                Button("Continue") { answer(titles(OnboardingCopy.goals, profile.goals), next: .daily) }
                    .buttonStyle(.pill).disabled(profile.goals.isEmpty).padding(.top, 4)
            }
        case .daily:
            VStack(spacing: 8) {
                ForEach(OnboardingCopy.dailyGoals, id: \.xp) { g in
                    option("\(g.detail.capitalizedFirst)", selected: false) {
                        profile.dailyGoalXP = g.xp
                        answer(g.detail.capitalizedFirst, next: .account)
                    }
                }
            }
        case .account:
            VStack(spacing: 10) {
                AppleSignInButton { message in
                    if let message { accountNote = message } else { accountNote = nil; answer("Signed in with Apple", next: .material) }
                }
                Button("Use email") { signingIn = true }.buttonStyle(.ghostPill)
                Button("Later") { answer("Later", next: .material) }.buttonStyle(TextLinkStyle(color: Palette.ink2))
            }
        case .material:
            VStack(spacing: 10) {
                Button("Add files or photos") { complete(then: .importScreens) }.buttonStyle(.pill)
                Button("Paste notes") { pasting = true }.buttonStyle(.ghostPill)
                Button("Try the samples") { store.addSample(); complete(then: .home) }.buttonStyle(.ghostPill)
                Button("I have a library file") { importingFile = true }.buttonStyle(TextLinkStyle(color: Palette.ink2))
            }
        }
    }

    func option(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button { tapCount += 1; action() } label: {
            HStack {
                Text(title).font(Typo.bodyBold)
                Spacer()
                if selected { Image(systemName: "checkmark").font(.system(size: 16, weight: .semibold)) }
            }
        }
        .buttonStyle(TileStyle(state: selected ? .selected : .normal, minHeight: 50))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    func titles(_ choices: [Choice], _ ids: [String]) -> String {
        choices.filter { ids.contains($0.id) }.map(\.title).joined(separator: ", ")
    }

    func toggle(_ list: inout [String], _ id: String) {
        if let i = list.firstIndex(of: id) { list.remove(at: i) } else { list.append(id) }
    }

    /// Records the user's answer as a bubble, then Ollie asks the next question.
    func answer(_ text: String, next: Step) {
        withAnimation(Motion.reduced(reduceMotion, Motion.spring)) {
            lines.append(Line(owl: false, text: text))
            typing = true
        }
        Task {
            try? await Task.sleep(nanoseconds: reduceMotion ? 150_000_000 : 650_000_000)
            withAnimation(Motion.reduced(reduceMotion, Motion.spring)) {
                typing = false
                step = next
                lines.append(Line(owl: true, text: Self.question(next)))
            }
        }
    }

    enum Next { case home, importScreens, sort }

    func complete(then next: Next) {
        if profile.bringing.isEmpty { profile.bringing = ["books"] }
        if profile.goals.isEmpty { profile.goals = ["ideas"] }
        store.finishOnboarding(profile)
        switch next {
        case .home: break
        case .importScreens: DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { store.showImport = true }
        case .sort: DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { store.path = [.sort] }
        }
    }
}

/// Three quiet dots while Ollie writes (fades, no bounce).
struct TypingBubble: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = 0
    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { i in
                Circle().fill(Palette.ink3).frame(width: 7, height: 7).opacity(reduceMotion || phase == i ? 1 : 0.35)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 16)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Palette.surfaceDim))
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 220_000_000)
                withAnimation(.easeInOut(duration: 0.2)) { phase = (phase + 1) % 3 }
            }
        }
        .accessibilityLabel("\(Mascot.name) is writing")
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

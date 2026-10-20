import SwiftUI

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

struct OnboardingView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var importer: Importer
    var onBack: () -> Void

    @State private var step = 0
    @State private var profile = Profile()
    @State private var reminder = Reminders.date(from: "20:00")
    @State private var pasting = false
    @State private var examDate = Calendar.current.date(byAdding: .day, value: 14, to: Date()) ?? Date()
    @State private var hasExam = false
    // Steps: 0 bringing, 1 exam (classes only), 2 goals, 3 practice, 4 daily goal, 5 reminder, 6 first material.
    private var order: [Int] { profile.bringing.contains("class") ? [0, 1, 2, 3, 4, 5, 6] : [0, 2, 3, 4, 5, 6] }
    private var steps: Int { order.count }
    private var position: Int { order.firstIndex(of: step) ?? 0 }
    private func advance() { withAnimation(Motion.slide) { step = order[min(order.count - 1, position + 1)] } }
    private func back() { withAnimation(Motion.slide) { step = order[max(0, position - 1)] } }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                IconButton(systemName: "chevron.left", label: "Back") {
                    if step == 0 { onBack() } else { back() }
                }
                ProgressBar(value: Double(position + 1) / Double(steps), color: Palette.blue)
                Color.clear.frame(width: 44, height: 44)
            }
            .padding(.horizontal, 8)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(title).font(Typo.title).foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 2)
                    if let s = subtitle { Text(s).font(Typo.body).foregroundStyle(Palette.muted).padding(.bottom, 8) }
                    content
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .id(step)
                .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
            }
            .scrollBounceBehavior(.basedOnSize)

            footer
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
        }
        .background(Palette.paper.ignoresSafeArea())
        .sheet(isPresented: $pasting, onDismiss: { if !store.library.inbox.isEmpty { complete(then: .sort) } }) { PasteNotesSheet() }
    }

    var title: String {
        switch step {
        case 0: return "What are you studying?"
        case 1: return "Got an exam coming up?"
        case 2: return "What do you want from it?"
        case 3: return "How do you like to practice?"
        case 4: return "Pick a daily goal"
        case 5: return "When should we nudge you?"
        default: return "Add your first material"
        }
    }

    var subtitle: String? {
        switch step {
        case 0, 2, 3: return "Pick as many as you like."
        case 1: return "We plan your study days so you are ready by then."
        case 5: return "One reminder a day, at a time you choose."
        case 6: return "Screenshots, photos of notes, PDFs, slides or docs. Add more any time."
        default: return nil
        }
    }

    @ViewBuilder var content: some View {
        switch step {
        case 0:
            ForEach(OnboardingCopy.bringing) { c in
                tile(c, selected: profile.bringing.contains(c.id), multi: true) { toggle(&profile.bringing, c.id) }
            }
        case 1:
            DatePicker("Exam date", selection: $examDate, in: Date()..., displayedComponents: .date)
                .datePickerStyle(.graphical)
                .tint(Palette.blue)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 16).fill(Palette.shelf))
        case 2:
            ForEach(OnboardingCopy.goals) { c in
                tile(c, selected: profile.goals.contains(c.id), multi: true) { toggle(&profile.goals, c.id) }
            }
        case 3:
            ForEach(OnboardingCopy.practice) { c in
                tile(c, selected: profile.practice.contains(c.id), multi: true) { toggle(&profile.practice, c.id) }
            }
        case 4:
            ForEach(OnboardingCopy.dailyGoals, id: \.xp) { g in
                Button { profile.dailyGoalXP = g.xp } label: {
                    HStack {
                        Text(g.title).font(Typo.bodyBold)
                        Text(g.detail).font(Typo.body).foregroundStyle(Palette.muted)
                        Spacer()
                        Text("\(g.xp) XP").font(Typo.small)
                    }
                }
                .buttonStyle(TileStyle(state: profile.dailyGoalXP == g.xp ? .selected : .normal))
            }
        case 5:
            DatePicker("Reminder time", selection: $reminder, displayedComponents: .hourAndMinute)
                .datePickerStyle(.wheel)
                .labelsHidden()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 16).fill(Palette.shelf))
        default:
            VStack(spacing: 12) {
                Button { complete(then: .importScreens) } label: { rowLabel("Add files or photos", "square.and.arrow.down", "Screenshots, whiteboard photos, PDFs, slides, docs") }
                    .buttonStyle(TileStyle())
                Button { pasting = true } label: { rowLabel("Paste notes", "doc.on.clipboard", "Paste excerpts copied from Notes") }
                    .buttonStyle(TileStyle())
                Button {
                    store.addSample()
                    complete(then: .home)
                } label: { rowLabel("Try the samples", "book.closed", "Two books and a BIO 101 class, ready to study") }
                    .buttonStyle(TileStyle())
            }
        }
    }

    @ViewBuilder var footer: some View {
        switch step {
        case 1:
            VStack(spacing: 10) {
                Button("Continue") { hasExam = true; advance() }.buttonStyle(.chunky)
                Button("Not yet") { hasExam = false; advance() }.buttonStyle(.chunky(.secondary))
            }
        case 5:
            VStack(spacing: 10) {
                Button("Allow notifications") {
                    Task {
                        let ok = await Reminders.request()
                        let s = Reminders.string(from: reminder)
                        profile.reminder = ok ? s : nil
                        if ok { Reminders.schedule(s) }
                        advance()
                    }
                }
                .buttonStyle(.chunky)
                Button("Not now") { profile.reminder = nil; advance() }
                    .buttonStyle(.chunky(.secondary))
            }
        case 6:
            EmptyView()
        default:
            Button("Continue") { advance() }
                .buttonStyle(.chunky)
                .disabled(step == 0 && profile.bringing.isEmpty || step == 2 && profile.goals.isEmpty || step == 3 && profile.practice.isEmpty)
        }
    }

    func tile(_ c: Choice, selected: Bool, multi: Bool = false, action: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); action() } label: {
            HStack(spacing: 14) {
                Image(systemName: c.icon).font(.system(size: 20, weight: .semibold)).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.title).font(Typo.bodyBold)
                    if let d = c.detail { Text(d).font(Typo.rounded(14, .medium)).foregroundStyle(Palette.muted) }
                }
                Spacer()
                if multi {
                    Image(systemName: selected ? "checkmark.square.fill" : "square")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(selected ? Palette.blue : Palette.line)
                }
            }
        }
        .buttonStyle(TileStyle(state: selected ? .selected : .normal, minHeight: 64))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    func rowLabel(_ title: String, _ icon: String, _ detail: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon).font(.system(size: 20, weight: .semibold)).frame(width: 28).foregroundStyle(Palette.blue)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Typo.bodyBold)
                Text(detail).font(Typo.rounded(14, .medium)).foregroundStyle(Palette.muted)
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(Palette.muted)
        }
    }

    func toggle(_ list: inout [String], _ id: String) {
        if let i = list.firstIndex(of: id) { list.remove(at: i) } else { list.append(id) }
    }

    enum Next { case home, importScreens, sort }

    func complete(then next: Next) {
        // The exam date applies to the first class project created.
        if hasExam && profile.bringing.contains("class") { UserDefaults.standard.set(DayKey.of(examDate), forKey: Store.pendingExamKey) }
        store.finishOnboarding(profile)
        switch next {
        case .home: break
        case .importScreens: DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { store.showImport = true }
        case .sort: DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { store.path = [.sort] }
        }
    }
}

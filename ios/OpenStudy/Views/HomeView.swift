import SwiftUI

struct HomeView: View {
    @EnvironmentObject var store: Store
    @State private var practiceEmpty = false

    var body: some View {
        let lib = store.library
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                statsBar
                if store.inboxCount > 0 { inboxRow }
                todayPlan
                if let (project, lesson) = lib.continueTarget() {
                    continueCard(project, lesson)
                    practiceButton
                } else {
                    emptyCard
                }
                if !lib.projects.isEmpty { shelf }
                ConnectionsSection()
                if !lib.projects.isEmpty {
                    AskBox(projectId: nil, placeholder: "Ask my notes")
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 4)
            .padding(.bottom, 30)
        }
        .background(Palette.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .alert("Practice", isPresented: $practiceEmpty) { Button("OK", role: .cancel) {} } message: { Text(store.nextReviewText) }
    }

    // MARK: Top stats

    var statsBar: some View {
        let lib = store.library
        let today = lib.stats.dayXP[DayKey.of(Date())] ?? 0
        return HStack(spacing: 18) {
            HStack(spacing: 6) {
                Image(systemName: "flame").font(.system(size: 20, weight: .regular)).foregroundStyle(store.streak > 0 ? Palette.ink : Palette.ink3)
                Text("\(store.streak)").font(Typo.mono(18, .medium)).foregroundStyle(Palette.ink)
                    .lineLimit(1).fixedSize()
            }
            .accessibilityElement(children: .ignore).accessibilityLabel("\(store.streak) day streak")
            HStack(spacing: 8) {
                GoalRing(progress: store.goal, size: 22, lineWidth: 3)
                Text("\(today)/\(lib.profile.dailyGoalXP) XP").font(Typo.mono(16, .regular)).foregroundStyle(Palette.ink2)
                    .lineLimit(1).fixedSize()
            }
            .accessibilityElement(children: .ignore).accessibilityLabel("Daily goal \(today) of \(lib.profile.dailyGoalXP) XP")
            Spacer()
            IconButton(systemName: "gearshape", label: "Settings") { store.sheet = .settings }
            Button { store.sheet = .profile } label: {
                AvatarCircle(initial: ProfileInfo.avatarInitial(name: lib.profile.name, email: nil), size: 34)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel("Profile")
        }
        .frame(height: 52)
    }

    var inboxRow: some View {
        Button { store.path.append(.sort) } label: {
            HStack(spacing: 12) {
                Image(systemName: "tray.full").font(.system(size: 18, weight: .regular)).foregroundStyle(Palette.ink)
                Text("New pages to sort").font(Typo.bodyBold).foregroundStyle(Palette.ink)
                Spacer()
                Text("\(store.inboxCount)").font(Typo.mono(16, .medium)).foregroundStyle(Palette.ink)
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.ink3)
            }
        }
        .buttonStyle(TileStyle(minHeight: 54))
    }

    // MARK: Today's plan

    @ViewBuilder var todayPlan: some View {
        let plan = store.plan
        if let today = plan.today, !today.items.isEmpty {
            let items = Array(today.items.prefix(5))
            let left = today.items.filter { !$0.done }.reduce(0) { $0 + $1.minutes }
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Today's Plan").font(Typo.headline).tracking(Typo.tracking(for: 20)).foregroundStyle(Palette.ink)
                    Spacer()
                    Button("Full plan") { store.path.append(.plan) }.buttonStyle(TextLinkStyle(color: Palette.ink2))
                }
                Text(left < 0.5 ? "All done for today." : "About \(Int(left.rounded(.up))) min left")
                    .font(Typo.small).foregroundStyle(Palette.muted)
                    .padding(.bottom, 4)
                VStack(spacing: 8) {
                    ForEach(items) { item in
                        Button { if !item.done { store.startPlanItem(item) } } label: {
                            PlanRow(item: item, color: planColor(item))
                                .padding(.horizontal, 14).padding(.vertical, 10)
                                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.surfaceDim))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(item.done)
                    }
                }
                if let f = plan.feasibility.first {
                    FeasibilityCard(f: f).padding(.top, 10)
                }
            }
        }
    }

    func planColor(_ item: PlanItem) -> Color {
        guard store.project(item.projectId) != nil else { return Palette.ink }
        return Palette.ink
    }

    // MARK: Continue

    func continueCard(_ project: Project, _ lesson: Lesson) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 16) {
                PathNode(color: project.color, level: lesson.level, locked: false, isQuotes: lesson.isQuotes, isCurrent: true)
                    .scaleEffect(0.78)
                    .frame(width: 78, height: 82)
                VStack(alignment: .leading, spacing: 4) {
                    Text(project.title).font(Typo.small).foregroundStyle(Palette.ink3).lineLimit(1)
                    Text(lesson.title).font(Typo.title).tracking(Typo.tracking(for: 24)).foregroundStyle(Palette.ink).lineLimit(2).minimumScaleFactor(0.8)
                    Text(lesson.level == 0 ? "New lesson" : "Level \(lesson.level) of 5")
                        .font(Typo.small).foregroundStyle(Palette.ink3)
                }
                Spacer(minLength: 0)
            }
            Button("Continue") { store.start(lesson: lesson) }
                .buttonStyle(.chunky)
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Palette.surfaceDim))
        .onTapGesture { store.path.append(.project(project.id)) }
    }

    var practiceButton: some View {
        let due = store.dueCount
        return VStack(spacing: 6) {
            Button {
                if !store.startPractice() { practiceEmpty = true }
            } label: {
                Text(due == 0 ? "Practice" : "Practice \(due) due")
            }
            .buttonStyle(.ghostPill)
            if !store.plusActive && store.library.projects.contains(where: { $0.sample != true }) {
                Text("\(store.currentUsage.quizzesLeft) of \(PlusLimits.freeQuizzes) free quizzes left this month")
                    .font(Typo.small).foregroundStyle(Palette.ink3)
            }
        }
    }

    var emptyCard: some View {
        VStack(spacing: 4) {
            OwlEmptyState(mood: .reading, title: "Your Shelf Is Empty",
                          message: "Add book pages, class slides or notes. I'll sort them and build the lessons.",
                          action: "Add material", perform: { store.showImport = true })
            Button("Try the samples") { store.addSample(); store.toast = "Samples added" }.buttonStyle(TextLinkStyle(color: Palette.ink2))
        }
    }

    // MARK: Shelf

    var shelf: some View {
        let projects = store.library.projects
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Your Shelf").font(Typo.headline).tracking(Typo.tracking(for: 20)).foregroundStyle(Palette.ink)
                Spacer()
                Text(projects.allSatisfy { $0.kind == "book" } ? (projects.count == 1 ? "1 book" : "\(projects.count) books") : (projects.count == 1 ? "1 project" : "\(projects.count) projects")).font(Typo.small).foregroundStyle(Palette.muted)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .bottom, spacing: 10) {
                    let clusters = Self.clusters(projects)
                    if clusters.count >= 2 {
                        // Spec 9.7: one labeled cluster per category, side by side on the same board.
                        ForEach(clusters, id: \.name) { c in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(c.name).font(Typo.tiny).foregroundStyle(Palette.ink3).lineLimit(1)
                                HStack(alignment: .bottom, spacing: 10) { spines(c.items) }
                            }
                            .padding(.trailing, 12)
                        }
                    } else {
                        spines(Array(projects.enumerated()).map { ($0.offset, $0.element) })
                    }
                    Button { store.showImport = true } label: { AddSpine(badge: store.inboxCount) }
                        .buttonStyle(SpineButtonStyle())
                        .accessibilityLabel("Add a book")
                }
                .padding(.horizontal, 20)
                .padding(.top, 10)
            }
            .padding(.horizontal, -20)
            // The plank.
            RoundedRectangle(cornerRadius: 4).fill(Palette.surfaceDim).frame(height: 10).padding(.top, -12)
        }
        .padding(.top, 6)
    }
}

extension HomeView {
    /// Categories sorted by name, projects in creation order inside each.
    static func clusters(_ projects: [Project]) -> [(name: String, items: [(Int, Project)])] {
        var order: [String] = []
        var by: [String: (name: String, items: [(Int, Project)])] = [:]
        for (i, p) in projects.enumerated() {
            let name = (p.category ?? "").trimmingCharacters(in: .whitespaces).isEmpty ? "General" : p.category!.trimmingCharacters(in: .whitespaces)
            let k = name.lowercased()
            if by[k] == nil { order.append(k); by[k] = (name, []) }
            by[k]!.items.append((i, p))
        }
        return order.sorted().map { by[$0]! }
    }

    func spines(_ items: [(Int, Project)]) -> some View {
        ForEach(items, id: \.1.id) { i, p in
            Button { store.path.append(.project(p.id)) } label: {
                BookSpine(title: p.title, author: p.author, color: p.color, height: [220, 204, 214, 196, 210][i % 5])
            }
            .buttonStyle(SpineButtonStyle())
        }
    }
}

struct AddSpine: View {
    var badge: Int = 0
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Palette.surfaceDim)
            Image(systemName: "plus").font(.system(size: 24, weight: .regular)).foregroundStyle(Palette.ink2)
        }
        .frame(width: 64, height: 190)
        .overlay(alignment: .topTrailing) {
            if badge > 0 {
                Text("\(badge)").font(Typo.mono(13, .semibold)).foregroundStyle(Palette.onAccent)
                    .padding(.horizontal, 7).frame(minWidth: 24, minHeight: 24)
                    .background(Capsule().fill(Palette.ink))
                    .offset(x: 8, y: -8)
            }
        }
        .padding(.bottom, 4)
    }
}

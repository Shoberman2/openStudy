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
                shelf
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
            HStack(spacing: 5) {
                Image(systemName: "flame.fill").font(.system(size: 22, weight: .bold)).foregroundStyle(store.streak > 0 ? Palette.yellow : Palette.line)
                Text("\(store.streak)").font(Typo.rounded(19, .heavy)).foregroundStyle(Palette.ink).monospacedDigit()
            }
            .accessibilityElement(children: .ignore).accessibilityLabel("\(store.streak) day streak")
            HStack(spacing: 5) {
                Image(systemName: "bolt.fill").font(.system(size: 20, weight: .bold)).foregroundStyle(Palette.yellow)
                Text("\(lib.stats.xp) XP").font(Typo.rounded(19, .heavy)).foregroundStyle(Palette.ink).monospacedDigit()
            }
            .accessibilityElement(children: .ignore).accessibilityLabel("\(lib.stats.xp) XP")
            HStack(spacing: 7) {
                GoalRing(progress: store.goal, size: 26, lineWidth: 5)
                Text("\(today)/\(lib.profile.dailyGoalXP)").font(Typo.rounded(15, .bold)).foregroundStyle(Palette.muted).monospacedDigit()
            }
            .accessibilityElement(children: .ignore).accessibilityLabel("Daily goal \(today) of \(lib.profile.dailyGoalXP) XP")
            Spacer()
            Button { store.path.append(.settings) } label: {
                Image(systemName: "gearshape.fill").font(.system(size: 20, weight: .semibold)).foregroundStyle(Palette.muted)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel("Settings")
        }
        .frame(height: 52)
    }

    var inboxRow: some View {
        Button { store.path.append(.sort) } label: {
            HStack(spacing: 12) {
                Image(systemName: "tray.full.fill").font(.system(size: 18, weight: .semibold)).foregroundStyle(Palette.blue)
                Text("New pages to sort").font(Typo.bodyBold).foregroundStyle(Palette.ink)
                Spacer()
                Text("\(store.inboxCount)")
                    .font(Typo.rounded(14, .heavy)).foregroundStyle(.white)
                    .padding(.horizontal, 9).frame(minWidth: 26, minHeight: 24)
                    .background(Capsule().fill(Palette.red))
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .bold)).foregroundStyle(Palette.muted)
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
                    Text("Today's plan").font(Typo.headline).foregroundStyle(Palette.ink)
                    Spacer()
                    Button { store.path.append(.plan) } label: {
                        HStack(spacing: 3) { Text("Full plan"); Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)) }
                            .font(Typo.rounded(15, .bold))
                    }
                }
                Text(left < 0.5 ? "All done for today." : "About \(Int(left.rounded(.up))) min left")
                    .font(Typo.small).foregroundStyle(Palette.muted)
                    .padding(.bottom, 4)
                VStack(spacing: 0) {
                    ForEach(items) { item in
                        Button { if !item.done { store.startPlanItem(item) } } label: {
                            PlanRow(item: item, color: planColor(item)).padding(.vertical, 9).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(item.done)
                        if item.id != items.last?.id { Rectangle().fill(Palette.line).frame(height: 1).padding(.leading, 50) }
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
                if let f = plan.feasibility.first {
                    FeasibilityCard(f: f).padding(.top, 10)
                }
            }
        }
    }

    func planColor(_ item: PlanItem) -> Color {
        guard let p = store.project(item.projectId) else { return Palette.blue }
        return p.color == .yellow ? Palette.yellowLip : p.color.fill
    }

    // MARK: Continue

    func continueCard(_ project: Project, _ lesson: Lesson) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 16) {
                PathNode(color: project.color, level: lesson.level, locked: false, isQuotes: lesson.isQuotes, isCurrent: true)
                    .scaleEffect(0.78)
                    .frame(width: 78, height: 82)
                VStack(alignment: .leading, spacing: 4) {
                    Text(project.title).font(Typo.small).foregroundStyle(Palette.muted).lineLimit(1)
                    Text(lesson.title).font(Typo.title).foregroundStyle(Palette.ink).lineLimit(2).minimumScaleFactor(0.8)
                    Text(lesson.level == 0 ? "New lesson" : "Level \(lesson.level) of 5")
                        .font(Typo.rounded(14, .bold)).foregroundStyle(Palette.muted)
                }
                Spacer(minLength: 0)
            }
            Button("Continue") { store.start(lesson: lesson) }
                .buttonStyle(.chunky)
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Palette.shelf))
        .onTapGesture { store.path.append(.project(project.id)) }
    }

    var practiceButton: some View {
        let due = store.dueCount
        return Button {
            if !store.startPractice() { practiceEmpty = true }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 17, weight: .bold))
                Text("Practice")
                Spacer()
                Text(due == 0 ? "Nothing due" : "\(due) due")
                    .font(Typo.rounded(15, .heavy))
                    .foregroundStyle(due == 0 ? Palette.muted : Palette.blue)
            }
        }
        .buttonStyle(.chunky(.secondary))
    }

    var emptyCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Add your first book").font(Typo.title).foregroundStyle(Palette.ink)
            Text("Import screenshots of book pages or paste excerpts from Notes. We sort them by book and build the lessons.")
                .font(Typo.body).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
            Button("Add pages") { store.showImport = true }.buttonStyle(.chunky).padding(.top, 6)
            Button("Try a sample book") { store.addSample() }.buttonStyle(.chunky(.secondary))
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Palette.shelf))
    }

    // MARK: Shelf

    var shelf: some View {
        let projects = store.library.projects
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Your shelf").font(Typo.headline).foregroundStyle(Palette.ink)
                Spacer()
                Text(projects.allSatisfy { $0.kind == "book" } ? (projects.count == 1 ? "1 book" : "\(projects.count) books") : (projects.count == 1 ? "1 project" : "\(projects.count) projects")).font(Typo.small).foregroundStyle(Palette.muted)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .bottom, spacing: 10) {
                    ForEach(Array(projects.enumerated()), id: \.element.id) { i, p in
                        Button { store.path.append(.project(p.id)) } label: {
                            BookSpine(title: p.title, author: p.author, color: p.color, height: [220, 204, 214, 196, 210][i % 5])
                        }
                        .buttonStyle(SpineButtonStyle())
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
            RoundedRectangle(cornerRadius: 4).fill(Palette.line).frame(height: 10).padding(.top, -14)
        }
        .padding(.top, 6)
    }
}

struct AddSpine: View {
    var badge: Int = 0
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Palette.line).offset(y: 4)
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Palette.paper)
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
            Image(systemName: "plus").font(.system(size: 24, weight: .heavy)).foregroundStyle(Palette.muted)
        }
        .frame(width: 64, height: 190)
        .overlay(alignment: .topTrailing) {
            if badge > 0 {
                Text("\(badge)").font(Typo.rounded(13, .heavy)).foregroundStyle(.white)
                    .padding(.horizontal, 7).frame(minWidth: 24, minHeight: 24)
                    .background(Capsule().fill(Palette.red))
                    .offset(x: 8, y: -8)
            }
        }
        .padding(.bottom, 4)
    }
}

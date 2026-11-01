import SwiftUI

struct PlanRow: View {
    let item: PlanItem
    var color: Color = Palette.blue
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.done ? "checkmark.circle" : icon)
                .font(.system(size: 20, weight: .regular))
                .foregroundStyle(item.done ? Palette.ok : Palette.ink)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(Typo.bodyBold).foregroundStyle(Palette.ink).lineLimit(1)
                Text(item.subtitle).font(Typo.small).foregroundStyle(Palette.ink3).lineLimit(1)
            }
            Spacer(minLength: 6)
            Text(minutesText).font(Typo.mono(15, .regular)).foregroundStyle(Palette.ink3)
                .fixedSize()
        }
        .opacity(item.done ? 0.7 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityValue(item.done ? "Done" : "")
    }

    var icon: String {
        switch item.kind {
        case .review: return "arrow.triangle.2.circlepath"
        case .test: return "checklist"
        case .lesson: return "star"
        }
    }

    var minutesText: String { "\(max(1, Int(item.minutes.rounded(.up)))) min" }
}

/// Full plan: next days grouped by date with exam markers (spec 8.6).
struct PlanView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss

    var body: some View {
        let plan = store.plan
        VStack(spacing: 0) {
            HStack { IconButton(systemName: "chevron.left", label: "Back") { dismiss() }; Spacer() }
                .padding(.horizontal, 8)
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your Plan").font(Typo.title).tracking(Typo.tracking(for: 24)).foregroundStyle(Palette.ink)
                        Text("About \(Int(plan.today?.budget ?? 10)) min a day. Reviews first, then new lessons spread out so they stick.")
                            .font(Typo.body).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(plan.feasibility, id: \.projectId) { f in FeasibilityCard(f: f) }
                    ForEach(Array(plan.days.enumerated()), id: \.element.key) { i, day in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(Self.dayTitle(day.date, index: i)).font(Typo.headline).foregroundStyle(Palette.ink)
                                Spacer()
                                Text("\(Int(day.minutes.rounded())) min").font(Typo.small).foregroundStyle(Palette.muted).monospacedDigit()
                            }
                            ForEach(day.exams, id: \.self) { pid in
                                Label("Exam: \(store.library.project(pid)?.title ?? "")", systemImage: "flag.fill")
                                    .font(Typo.rounded(15, .heavy)).foregroundStyle(Palette.redText)
                                    .padding(.horizontal, 12).padding(.vertical, 8)
                                    .background(Capsule().fill(Palette.redSoft))
                            }
                            if day.items.isEmpty {
                                Text(day.exams.isEmpty ? "Rest day. Nothing planned." : "Good luck. Light review only.")
                                    .font(Typo.rounded(15, .medium)).foregroundStyle(Palette.muted)
                            }
                            VStack(spacing: 8) {
                                ForEach(day.items) { item in
                                    Button { if i == 0 && !item.done { store.startPlanItem(item) } } label: {
                                        PlanRow(item: item, color: color(item))
                                            .padding(.horizontal, 14).padding(.vertical, 10)
                                            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.surfaceDim))
                                            .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .allowsHitTesting(i == 0 && !item.done)
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        .background(Palette.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    func color(_ item: PlanItem) -> Color {
        guard let p = store.project(item.projectId) else { return Palette.blue }
        return Palette.ink
    }

    static func dayTitle(_ d: Date, index: Int) -> String {
        if index == 0 { return "Today" }
        if index == 1 { return "Tomorrow" }
        let f = DateFormatter(); f.dateFormat = "EEE, MMM d"
        return f.string(from: d)
    }
}

struct FeasibilityCard: View {
    @EnvironmentObject var store: Store
    let f: Feasibility
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("To be ready for \(f.title) by \(Self.date(f.goalDate)) you need about \(f.minutesNeeded) min a day.")
                .font(Typo.bodyBold).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
            Button("Use \(f.minutesNeeded) min") {
                if let i = store.library.projects.firstIndex(where: { $0.id == f.projectId }) { store.library.projects[i].minutesPerDay = f.minutesNeeded }
            }
            .buttonStyle(.chunky(.yellow, height: 46))
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.yellowSoft))
    }

    static func date(_ key: String) -> String {
        guard let d = DayKey.date(key) else { return key }
        let f = DateFormatter(); f.dateFormat = "MMM d"
        return f.string(from: d)
    }
}

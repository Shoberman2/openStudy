import SwiftUI

struct CompletionView: View {
    let summary: SessionSummary
    let title: String
    var onContinue: () -> Void
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @State private var shownXP = 0
    @State private var ring: Double = 0

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 22) {
                ZStack {
                    GoalRing(progress: ring, size: 150, lineWidth: 14)
                    VStack(spacing: 0) {
                        Text("+\(shownXP)")
                            .font(Typo.mono(44, .semibold, relativeTo: .largeTitle))
                            .foregroundStyle(Palette.ink)
                            .contentTransition(.numericText(value: Double(shownXP)))
                            .monospacedDigit()
                        Text("XP").font(Typo.smallBold).foregroundStyle(Palette.ink3)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(summary.xp) XP earned")
                VStack(spacing: 6) {
                    OwlView(mood: .happy, size: 56).padding(.bottom, 4)
                    Text(summary.isPractice ? "Practice Done" : "Lesson Complete")
                        .font(Typo.display).tracking(Typo.tracking(for: 32)).foregroundStyle(Palette.ink)
                    Text(summary.perfect ? "No mistakes. \(title) is sticking." : "\(title), one level further.")
                        .font(Typo.body).foregroundStyle(Palette.ink2).multilineTextAlignment(.center)
                }
                HStack(spacing: 0) {
                    stat("Accuracy", "\(Int((summary.accuracy * 100).rounded()))%")
                    stat("Time", timeText)
                    stat("Streak", "\(summary.streak) \(summary.streak == 1 ? "day" : "days")")
                }
                .padding(.top, 6)
                if summary.goalAfter >= 1 && summary.goalBefore < 1 {
                    Label("Daily goal reached", systemImage: "checkmark.circle")
                        .font(Typo.bodyBold).foregroundStyle(Palette.ok)
                }
            }
            .padding(.horizontal, 20)
            Spacer()
            Button("Continue", action: onContinue)
                .buttonStyle(.chunky)
                .padding(.horizontal, 20).padding(.bottom, 8)
        }
        .background(Palette.bg.ignoresSafeArea())
        .onAppear(perform: animate)
    }

    var timeText: String {
        let m = summary.seconds / 60, s = summary.seconds % 60
        return m > 0 ? "\(m):\(String(format: "%02d", s))" : "\(s)s"
    }

    func stat(_ label: String, _ value: String) -> some View {
        VStack(spacing: 4) {
            Text(value).font(Typo.mono(20, .medium)).foregroundStyle(Palette.ink).lineLimit(1).minimumScaleFactor(0.8)
            Text(label).font(Typo.small).foregroundStyle(Palette.ink3)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    func animate() {
        Haptics.success()
        ring = summary.goalBefore
        if reduceMotion { shownXP = summary.xp; ring = summary.goalAfter; return }
        let steps = max(1, min(summary.xp, 24))
        for i in 1...steps {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25 + Double(i) * 0.04) {
                withAnimation(.easeOut(duration: 0.12)) { shownXP = Int((Double(summary.xp) * Double(i) / Double(steps)).rounded()) }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { withAnimation(.easeOut(duration: 0.9)) { ring = summary.goalAfter } }
    }
}

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
                            .font(.system(size: 46, weight: .heavy, design: .rounded))
                            .foregroundStyle(Palette.ink)
                            .contentTransition(.numericText(value: Double(shownXP)))
                            .monospacedDigit()
                        Text("XP").font(Typo.rounded(16, .heavy)).foregroundStyle(Palette.yellowLip)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(summary.xp) XP earned")
                VStack(spacing: 6) {
                    Text(summary.isPractice ? "Practice done" : "Lesson complete")
                        .font(Typo.display).tracking(-0.6).foregroundStyle(Palette.ink)
                    Text(summary.perfect ? "No mistakes. \(title) is sticking." : "\(title), one level further.")
                        .font(Typo.body).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                }
                HStack(spacing: 10) {
                    stat("Accuracy", "\(Int((summary.accuracy * 100).rounded()))%", Palette.green, "target")
                    stat("Time", timeText, Palette.blue, "clock")
                    stat("Streak", "\(summary.streak)", Palette.yellowLip, "flame.fill")
                }
                if summary.goalAfter >= 1 && summary.goalBefore < 1 {
                    Label("Daily goal reached", systemImage: "checkmark.circle.fill")
                        .font(Typo.bodyBold).foregroundStyle(Palette.greenText)
                }
            }
            .padding(.horizontal, 20)
            Spacer()
            Button("Continue", action: onContinue)
                .buttonStyle(.chunky)
                .padding(.horizontal, 20).padding(.bottom, 8)
        }
        .background(Palette.paper.ignoresSafeArea())
        .onAppear(perform: animate)
    }

    var timeText: String {
        let m = summary.seconds / 60, s = summary.seconds % 60
        return m > 0 ? "\(m):\(String(format: "%02d", s))" : "\(s)s"
    }

    func stat(_ label: String, _ value: String, _ color: Color, _ icon: String) -> some View {
        VStack(spacing: 6) {
            Text(label).font(Typo.tiny).foregroundStyle(Palette.muted)
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 15, weight: .bold))
                Text(value).font(Typo.rounded(20, .heavy)).monospacedDigit()
            }
            .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, minHeight: 74)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
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

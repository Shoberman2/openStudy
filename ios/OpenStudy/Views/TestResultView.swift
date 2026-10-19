import SwiftUI

/// Practice test results: score, per-lesson accuracy bars, "Review your misses" (spec 8.6).
struct TestResultView: View {
    let summary: SessionSummary
    let result: TestResult
    var onMisses: ([String]) -> Void
    var onDone: () -> Void
    @State private var shown = 0

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Practice test").font(Typo.small).foregroundStyle(Palette.muted)
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("\(shown)%")
                                .font(.system(size: 56, weight: .heavy, design: .rounded))
                                .foregroundStyle(Palette.ink)
                                .contentTransition(.numericText(value: Double(shown)))
                                .monospacedDigit()
                            Text("correct").font(Typo.headline).foregroundStyle(Palette.muted)
                        }
                        Text(verdict).font(Typo.body).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        Text("By lesson").font(Typo.headline).foregroundStyle(Palette.ink)
                        ForEach(result.perLesson, id: \.lessonId) { l in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(l.title).font(Typo.bodyBold).foregroundStyle(Palette.ink).lineLimit(2)
                                    Spacer(minLength: 8)
                                    Text("\(l.correct) of \(l.total)").font(Typo.rounded(15, .bold)).foregroundStyle(l.accuracy < 0.7 ? Palette.redText : Palette.greenText)
                                        .monospacedDigit()
                                }
                                ProgressBar(value: l.accuracy, color: l.accuracy < 0.7 ? Palette.red : Palette.green, height: 12)
                                if l.accuracy < 0.7 {
                                    Text("Moved up in your plan").font(Typo.rounded(13, .semibold)).foregroundStyle(Palette.muted)
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
            VStack(spacing: 10) {
                if !result.missedCards.isEmpty {
                    Button("Review your misses (\(result.missedCards.count))") { onMisses(result.missedCards) }.buttonStyle(.chunky)
                    Button("Done", action: onDone).buttonStyle(.chunky(.secondary))
                } else {
                    Button("Done", action: onDone).buttonStyle(.chunky)
                }
            }
            .padding(.horizontal, 20).padding(.bottom, 8)
        }
        .background(Palette.paper.ignoresSafeArea())
        .onAppear {
            let target = Int((result.accuracy * 100).rounded())
            for i in 1...10 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2 + Double(i) * 0.05) {
                    withAnimation(.easeOut(duration: 0.12)) { shown = Int(Double(target) * Double(i) / 10) }
                }
            }
        }
    }

    var verdict: String {
        if result.weakLessons.isEmpty { return "Every lesson is at 70% or better. Keep the reviews going." }
        let n = result.weakLessons.count
        return "\(n) \(n == 1 ? "lesson needs" : "lessons need") another pass. Your plan puts \(n == 1 ? "it" : "them") first."
    }
}

import SwiftUI

/// The vertical zigzag lesson path (spec 6.4, 7). Used on the Project screen and behind the Welcome screen.
struct LessonPath: View {
    let library: Library
    let project: Project
    var interactive = true
    var onTap: (Lesson) -> Void = { _ in }

    static let offsets: [CGFloat] = [0, 60, 90, 60, 0, -60, -90, -60]

    var body: some View {
        let lessons = library.lessons(of: project.id)
        let current = library.currentLesson(of: project.id)
        VStack(spacing: 22) {
            ForEach(Array(lessons.enumerated()), id: \.element.id) { i, lesson in
                let locked = !library.isUnlocked(lesson)
                let isCurrent = lesson.id == current?.id
                VStack(spacing: 2) {
                    if isCurrent {
                        StartTag(text: lesson.level == 0 ? "Start" : "Next", color: project.color)
                            .padding(.bottom, -4)
                    } else {
                        Color.clear.frame(height: 0)
                    }
                    Button { onTap(lesson) } label: { EmptyView() }
                        .buttonStyle(PathNodeButtonStyle(color: project.color, level: lesson.level, locked: locked, isQuotes: lesson.isQuotes, isCurrent: isCurrent))
                        .disabled(!interactive)
                        .accessibilityLabel("\(lesson.title), level \(lesson.level) of 5\(locked ? ", locked" : "")")
                    Text(lesson.title)
                        .font(Typo.rounded(14, .bold))
                        .foregroundStyle(locked ? Palette.muted : Palette.ink)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .frame(width: 150)
                        .accessibilityHidden(true)
                }
                .offset(x: Self.offsets[i % Self.offsets.count])
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
}

struct LessonSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    let lessonId: String

    var body: some View {
        let lib = store.library
        if let lesson = lib.lessons.first(where: { $0.id == lessonId }), let project = lib.project(lesson.projectId) {
            let locked = !lib.isUnlocked(lesson)
            let count = lib.cards(of: lesson.id).count
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    LevelRing(level: lesson.level, diameter: 44, lineWidth: 5)
                        .overlay(Text("\(lesson.level)").font(Typo.rounded(16, .heavy)).foregroundStyle(Palette.ink))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(lesson.title).font(Typo.title).foregroundStyle(Palette.ink)
                        Text(lesson.isQuotes ? "\(count) quotes, level \(lesson.level) of 5" : "\(count) cards, level \(lesson.level) of 5")
                            .font(Typo.small).foregroundStyle(Palette.muted)
                    }
                }
                Text(lesson.summary)
                    .font(Typo.serif(18))
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if locked {
                    Text("Finish the lesson before this one to open it.")
                        .font(Typo.small).foregroundStyle(Palette.muted)
                    Button("Locked") {}.buttonStyle(.chunky).disabled(true)
                } else {
                    Button(lesson.level == 0 ? "Start" : lesson.level >= 5 ? "Practice again" : "Start level \(lesson.level + 1)") {
                        dismiss()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { store.start(lesson: lesson) }
                    }
                    .buttonStyle(.chunky(.custom(fill: project.color.fill, lip: project.color.lip, text: project.color.text)))
                }
            }
            .padding(24)
            .presentationDetents([.height(330)])
            .presentationDragIndicator(.visible)
            .presentationBackground(Palette.paper)
        }
    }
}

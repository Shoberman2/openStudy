import SwiftUI

/// OpenStudy's study character. Rename here and in ios/DESIGN.md: every screen reads `Mascot.name`.
enum Mascot {
    static let name = "Ollie"
}

/// Ollie: a small ink owl with round reading glasses, drawn as vector art (no image assets, no
/// background behind it). Moods give it a little personality in the chat and empty states.
struct OwlView: View {
    enum Mood { case neutral, happy, thinking, reading, sleepy }
    var mood: Mood = .neutral
    var size: CGFloat = 96
    /// Blinks now and then. Off when Reduce Motion is on.
    var blinks = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var blink = false

    var body: some View {
        Canvas { ctx, canvas in
            let s = canvas.width / 100
            func r(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect { CGRect(x: x * s, y: y * s, width: w * s, height: h * s) }
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }

            // Ear tufts.
            var tufts = Path()
            tufts.move(to: p(20, 34)); tufts.addLine(to: p(17, 6)); tufts.addLine(to: p(40, 22)); tufts.closeSubpath()
            tufts.move(to: p(80, 34)); tufts.addLine(to: p(83, 6)); tufts.addLine(to: p(60, 22)); tufts.closeSubpath()
            ctx.fill(tufts, with: .color(Palette.Owl.body))

            // Body.
            ctx.fill(Path(roundedRect: r(14, 14, 72, 90), cornerRadius: 36 * s), with: .color(Palette.Owl.body))

            // Belly with three small feather marks.
            ctx.fill(Path(ellipseIn: r(30, 62, 40, 38)), with: .color(Palette.Owl.face))
            var marks = Path()
            for (x, y) in [(42.0, 74.0), (54.0, 74.0), (48.0, 84.0)] {
                marks.move(to: p(x - 3, y)); marks.addLine(to: p(x, y + 3)); marks.addLine(to: p(x + 3, y))
            }
            ctx.stroke(marks, with: .color(Palette.Owl.wing), style: StrokeStyle(lineWidth: 1.8 * s, lineCap: .round, lineJoin: .round))

            // Wings.
            ctx.fill(Path(ellipseIn: r(9, 54, 17, 38)), with: .color(Palette.Owl.wing))
            ctx.fill(Path(ellipseIn: r(74, 54, 17, 38)), with: .color(Palette.Owl.wing))

            // Face discs.
            ctx.fill(Path(ellipseIn: r(23, 29, 30, 30)), with: .color(Palette.Owl.face))
            ctx.fill(Path(ellipseIn: r(47, 29, 30, 30)), with: .color(Palette.Owl.face))

            // Eyes.
            let lx: CGFloat = 38, rx: CGFloat = 62, ey: CGFloat = 45
            let closed = blink || mood == .sleepy
            if mood == .happy {
                var arcs = Path()
                for cx in [lx, rx] {
                    arcs.move(to: p(cx - 6, ey + 2)); arcs.addQuadCurve(to: p(cx + 6, ey + 2), control: p(cx, ey - 6))
                }
                ctx.stroke(arcs, with: .color(Palette.Owl.eye), style: StrokeStyle(lineWidth: 3 * s, lineCap: .round))
            } else if closed {
                var lids = Path()
                for cx in [lx, rx] {
                    lids.move(to: p(cx - 6, ey)); lids.addQuadCurve(to: p(cx + 6, ey), control: p(cx, ey + 5))
                }
                ctx.stroke(lids, with: .color(Palette.Owl.eye), style: StrokeStyle(lineWidth: 3 * s, lineCap: .round))
            } else {
                let look: (CGFloat, CGFloat) = mood == .thinking ? (3, -3) : (mood == .reading ? (0, 3) : (0, 0))
                for cx in [lx, rx] {
                    ctx.fill(Path(ellipseIn: r(cx - 6.5 + look.0, ey - 6.5 + look.1, 13, 13)), with: .color(Palette.Owl.eye))
                    ctx.fill(Path(ellipseIn: r(cx - 3.5 + look.0, ey - 4.5 + look.1, 4, 4)), with: .color(Palette.Owl.face))
                }
            }

            // Round reading glasses.
            var glasses = Path()
            glasses.addEllipse(in: r(26, 32, 24, 24))
            glasses.addEllipse(in: r(50, 32, 24, 24))
            glasses.move(to: p(47, 42)); glasses.addQuadCurve(to: p(53, 42), control: p(50, 39))
            ctx.stroke(glasses, with: .color(Palette.Owl.wing), lineWidth: 2.2 * s)

            // Beak.
            var beak = Path()
            beak.move(to: p(45.5, 56)); beak.addLine(to: p(54.5, 56)); beak.addLine(to: p(50, 64)); beak.closeSubpath()
            ctx.fill(beak, with: .color(Palette.Owl.beak))

            // A book held in front when reading.
            if mood == .reading {
                ctx.fill(Path(roundedRect: r(28, 74, 44, 24), cornerRadius: 3 * s), with: .color(Palette.Owl.book))
                ctx.fill(Path(roundedRect: r(31, 76, 18, 20), cornerRadius: 2 * s), with: .color(Palette.Owl.page))
                ctx.fill(Path(roundedRect: r(51, 76, 18, 20), cornerRadius: 2 * s), with: .color(Palette.Owl.page))
            }

            // Feet.
            ctx.fill(Path(ellipseIn: r(34, 100, 11, 6)), with: .color(Palette.Owl.beak))
            ctx.fill(Path(ellipseIn: r(55, 100, 11, 6)), with: .color(Palette.Owl.beak))
        }
        .frame(width: size, height: size * 1.07)
        .accessibilityElement()
        .accessibilityLabel("\(Mascot.name), the OpenStudy owl")
        .task(id: blinks && !reduceMotion) {
            guard blinks, !reduceMotion else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64.random(in: 2_800_000_000...5_000_000_000))
                blink = true
                try? await Task.sleep(nanoseconds: 140_000_000)
                blink = false
            }
        }
    }
}

/// A screen-specific empty state: Ollie, one short Title Case line, one sentence, one action.
struct OwlEmptyState: View {
    var mood: OwlView.Mood = .reading
    var title: String
    var message: String
    var action: String?
    var perform: (() -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            OwlView(mood: mood, size: 92)
            Text(title)
                .font(Typo.title).tracking(Typo.tracking(for: 24))
                .foregroundStyle(Palette.ink)
                .multilineTextAlignment(.center)
            Text(message)
                .font(Typo.body).foregroundStyle(Palette.ink2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let action, let perform {
                Button(action, action: perform).buttonStyle(.pill).padding(.top, 6)
            }
        }
        .padding(.vertical, 24)
        .frame(maxWidth: .infinity)
    }
}

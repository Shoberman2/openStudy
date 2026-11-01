import SwiftUI
import UIKit

// MARK: - Pill buttons (one button component for the whole app, words only)

enum ChunkyKind { case primary, secondary, green, red, yellow, custom(fill: Color, lip: Color, text: Color) }

struct ChunkyButtonStyle: ButtonStyle {
    var kind: ChunkyKind = .primary
    var height: CGFloat = 52
    var fullWidth = true
    @Environment(\.isEnabled) private var isEnabled

    private var colors: (fill: Color, text: Color, border: Color?) {
        if !isEnabled { return (Palette.surfaceDim, Palette.ink3, nil) }
        switch kind {
        case .primary, .yellow: return (Palette.accent, Palette.onAccent, nil)
        case .secondary: return (Palette.bg, Palette.ink, Palette.lineStrong)
        case .green: return (Palette.ok, Palette.onStatus, nil)
        case .red: return (Palette.bad, Palette.onStatus, nil)
        case .custom(let f, _, let t): return (f, t, nil)
        }
    }

    func makeBody(configuration: Configuration) -> some View {
        let c = colors
        let pressed = configuration.isPressed && isEnabled
        return configuration.label
            .font(Typo.bodyBold)
            .foregroundStyle(c.text)
            .lineLimit(1)
            .minimumScaleFactor(0.85)
            .padding(.horizontal, 26)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: height)
            .background(Capsule().fill(c.fill))
            .overlay { if let b = c.border { Capsule().strokeBorder(b, lineWidth: 1.5) } }
            .contentShape(Capsule())
            .scaleEffect(pressed ? 0.98 : 1)
            .opacity(pressed ? 0.88 : 1)
            .animation(.easeOut(duration: 0.12), value: pressed)
            .sensoryFeedback(.impact(weight: .light), trigger: pressed) { _, now in now }
    }
}

extension ButtonStyle where Self == ChunkyButtonStyle {
    static var chunky: ChunkyButtonStyle { ChunkyButtonStyle() }
    static func chunky(_ kind: ChunkyKind, height: CGFloat = 52, fullWidth: Bool = true) -> ChunkyButtonStyle {
        ChunkyButtonStyle(kind: kind, height: height, fullWidth: fullWidth)
    }
    static var pill: ChunkyButtonStyle { ChunkyButtonStyle() }
    static var ghostPill: ChunkyButtonStyle { ChunkyButtonStyle(kind: .secondary) }
}

/// Plain text action (secondary links): ink, medium weight, 44pt tall.
struct TextLinkStyle: ButtonStyle {
    var color: Color = Palette.ink
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typo.bodyBold)
            .foregroundStyle(color)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.55 : 1)
            .sensoryFeedback(.selection, trigger: configuration.isPressed) { _, now in now }
    }
}

// MARK: - Option tiles (quiet fill, ink outline when picked, status tint when graded)

enum TileState { case normal, selected, correct, wrong, disabled }

struct TileStyle: ButtonStyle {
    var state: TileState = .normal
    var minHeight: CGFloat = 56
    var alignment: Alignment = .leading

    func makeBody(configuration: Configuration) -> some View {
        let (border, fill, text): (Color?, Color, Color) = {
            switch state {
            case .normal: return (nil, Palette.surfaceDim, Palette.ink)
            case .selected: return (Palette.ink, Palette.bg, Palette.ink)
            case .correct: return (Palette.ok, Palette.okSoft, Palette.ok)
            case .wrong: return (Palette.bad, Palette.badSoft, Palette.bad)
            case .disabled: return (nil, Palette.surfaceDim, Palette.ink3.opacity(0.7))
            }
        }()
        let pressed = configuration.isPressed && state != .disabled
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        return configuration.label
            .font(Typo.bodyBold)
            .foregroundStyle(text)
            .multilineTextAlignment(alignment == .leading ? .leading : .center)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: minHeight, alignment: alignment)
            .background(shape.fill(fill))
            .overlay { if let border { shape.strokeBorder(border, lineWidth: 2) } }
            .contentShape(shape)
            .scaleEffect(pressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.12), value: pressed)
            .sensoryFeedback(.selection, trigger: pressed) { _, now in now }
    }
}

/// Word chip for banks and ordering.
struct ChipStyle: ButtonStyle {
    var state: TileState = .normal
    func makeBody(configuration: Configuration) -> some View {
        TileStyle(state: state, minHeight: 44, alignment: .center).makeBody(configuration: configuration)
            .fixedSize()
    }
}

// MARK: - Progress bar (thin, quiet track, ink fill)

struct ProgressBar: View {
    var value: Double
    var color: Color = Palette.accent
    var height: CGFloat = 8

    var body: some View {
        GeometryReader { geo in
            let w = max(value > 0 ? height : 0, geo.size.width * min(1, max(0, value)))
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.surfaceDim)
                Capsule().fill(color).frame(width: w)
            }
        }
        .frame(height: height)
        .animation(.easeOut(duration: 0.25), value: value)
        .accessibilityElement()
        .accessibilityValue("\(Int(value * 100)) percent")
    }
}

// MARK: - Rings

struct GoalRing: View {
    var progress: Double
    var size: CGFloat = 30
    var lineWidth: CGFloat = 4
    var body: some View {
        ZStack {
            Circle().stroke(Palette.surfaceDim, lineWidth: lineWidth)
            Circle().trim(from: 0, to: min(1, progress))
                .stroke(Palette.accent, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
        .animation(.easeOut(duration: 0.6), value: progress)
    }
}

/// Five-segment level ring around a path node.
struct LevelRing: View {
    var level: Int
    var diameter: CGFloat
    var lineWidth: CGFloat = 5
    var body: some View {
        ZStack {
            ForEach(0..<5, id: \.self) { i in
                let gap = 0.025
                Circle()
                    .trim(from: Double(i) / 5 + gap, to: Double(i + 1) / 5 - gap)
                    .stroke(i < level ? Palette.ink : Palette.surfaceDim, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
        }
        .frame(width: diameter, height: diameter)
    }
}

// MARK: - Path node

struct PathNode: View {
    var color: ProjectColor
    var level: Int
    var locked: Bool
    var isQuotes: Bool
    var isCurrent: Bool
    var pressed: Bool = false

    var body: some View {
        let fill = locked ? Palette.surfaceDim : (isCurrent ? Palette.ink : color.fill)
        let fg = locked ? Palette.ink3 : (isCurrent ? Palette.onAccent : color.text)
        ZStack {
            LevelRing(level: locked ? 0 : level, diameter: 94, lineWidth: 5)
            Circle().fill(fill).frame(width: 72, height: 72)
                .overlay { if !locked && !isCurrent, let e = color.edge { Circle().strokeBorder(e, lineWidth: 1.5) } }
            Group {
                if locked {
                    Image(systemName: "lock")
                } else if isQuotes {
                    Image(systemName: "quote.opening")
                } else if level >= 5 {
                    Image(systemName: "checkmark")
                } else {
                    Image(systemName: "star")
                }
            }
            .font(.system(size: 24, weight: .medium))
            .foregroundStyle(fg)
        }
        .scaleEffect(pressed ? 0.96 : 1)
        .frame(width: 100, height: 104)
    }
}

struct PathNodeButtonStyle: ButtonStyle {
    var color: ProjectColor; var level: Int; var locked: Bool; var isQuotes: Bool; var isCurrent: Bool
    func makeBody(configuration: Configuration) -> some View {
        PathNode(color: color, level: level, locked: locked, isQuotes: isQuotes, isCurrent: isCurrent, pressed: configuration.isPressed)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
            .sensoryFeedback(.impact(weight: .light), trigger: configuration.isPressed) { _, now in now }
    }
}

/// Small speech bubble above the current node.
struct StartTag: View {
    var text = "Start"
    var color: ProjectColor
    var body: some View {
        VStack(spacing: 0) {
            Text(text)
                .font(Typo.smallBold)
                .foregroundStyle(Palette.onAccent)
                .padding(.horizontal, 14).padding(.vertical, 7)
                .background(Capsule().fill(Palette.ink))
            Triangle().fill(Palette.ink).frame(width: 12, height: 6)
        }
    }
}

struct Triangle: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path(); p.move(to: CGPoint(x: r.minX, y: r.minY)); p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        p.addLine(to: CGPoint(x: r.midX, y: r.maxY)); p.closeSubpath(); return p
    }
}

// MARK: - Book spine

struct BookSpine: View {
    var title: String
    var author: String?
    var color: ProjectColor
    var width: CGFloat = 64
    var height: CGFloat = 220
    var badge: Int = 0

    var body: some View {
        let band = color.text.opacity(0.22)
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(color.fill)
                .overlay { if let e = color.edge { RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(e, lineWidth: 1.5) } }
            VStack(spacing: 0) {
                band.frame(height: 3).padding(.top, 14)
                Spacer()
                band.frame(height: 3).padding(.bottom, 30)
            }
            Text(title)
                .font(Typo.geist(15, .semibold, relativeTo: .subheadline))
                .foregroundStyle(color.text)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .minimumScaleFactor(0.7)
                .frame(width: height - 74, height: width - 16, alignment: .leading)
                .rotationEffect(.degrees(90))
                .frame(width: width, height: height)
                .offset(y: -10)
            VStack {
                Spacer()
                if let a = author, !a.isEmpty {
                    Text(lastName(a))
                        .font(Typo.geist(9, .semibold, relativeTo: .caption2))
                        .foregroundStyle(color.text.opacity(0.85))
                        .lineLimit(1).minimumScaleFactor(0.6)
                        .padding(.horizontal, 4)
                        .padding(.bottom, 10)
                }
            }
        }
        .frame(width: width, height: height)
        .padding(.bottom, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(author.map { "\(title), \($0)" } ?? title)
    }

    func lastName(_ s: String) -> String {
        s.split(separator: " ").last.map(String.init)?.uppercased() ?? s
    }
}

struct SpineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .offset(y: configuration.isPressed ? 2 : 0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
            .sensoryFeedback(.impact(weight: .light), trigger: configuration.isPressed) { _, now in now }
    }
}

// MARK: - Flow layout for word banks and blanks

struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 10
    var alignment: HorizontalAlignment = .leading

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        let rows = arrange(maxW, subviews)
        let h = rows.reduce(0) { $0 + $1.height } + CGFloat(max(0, rows.count - 1)) * lineSpacing
        let w = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? w, height: h)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(bounds.width, subviews)
        var y = bounds.minY
        for row in rows {
            var x = bounds.minX
            if alignment == .center { x += (bounds.width - row.width) / 2 }
            for i in row.items {
                let s = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: y + (row.height - s.height) / 2), proposal: ProposedViewSize(s))
                x += s.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    struct Row { var items: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    func arrange(_ maxW: CGFloat, _ subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for (i, v) in subviews.enumerated() {
            let s = v.sizeThatFits(.unspecified)
            let extra = rows[rows.count - 1].items.isEmpty ? s.width : s.width + spacing
            if rows[rows.count - 1].width + extra > maxW, !rows[rows.count - 1].items.isEmpty {
                rows.append(Row())
            }
            let add = rows[rows.count - 1].items.isEmpty ? s.width : s.width + spacing
            rows[rows.count - 1].items.append(i)
            rows[rows.count - 1].width += add
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, s.height)
        }
        return rows.filter { !$0.items.isEmpty }
    }
}

// MARK: - Effects

struct Shake: GeometryEffect {
    var amount: CGFloat = 8
    var animatableData: CGFloat
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: amount * sin(animatableData * .pi * 4), y: 0))
    }
}

enum Haptics {
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
}

struct Panel<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Palette.surfaceDim))
    }
}

struct SectionLabel: View {
    var text: String
    var body: some View {
        Text(text).font(Typo.small).foregroundStyle(Palette.ink3)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct IconButton: View {
    var systemName: String
    var label: String
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 19, weight: .regular))
                .foregroundStyle(Palette.ink2)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(label)
    }
}

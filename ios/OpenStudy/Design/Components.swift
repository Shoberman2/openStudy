import SwiftUI
import UIKit

// MARK: - Chunky buttons (radius 16, height 52, bottom lip that presses down)

enum ChunkyKind { case primary, secondary, green, red, yellow, custom(fill: Color, lip: Color, text: Color) }

struct ChunkyButtonStyle: ButtonStyle {
    var kind: ChunkyKind = .primary
    var height: CGFloat = 52
    var fullWidth = true
    @Environment(\.isEnabled) private var isEnabled

    private var colors: (fill: Color, lip: Color, text: Color, border: Color?) {
        if !isEnabled { return (Palette.shelf, Palette.line, Palette.muted, nil) }
        switch kind {
        case .primary: return (Palette.blue, Palette.blueLip, .white, nil)
        case .secondary: return (Palette.paper, Palette.line, Palette.ink, Palette.line)
        case .green: return (Palette.green, Palette.greenLip, .white, nil)
        case .red: return (Palette.red, Palette.redLip, .white, nil)
        case .yellow: return (Palette.yellow, Palette.yellowLip, Color(uiColor: UIColor(hex: 0x141414)), nil)
        case .custom(let f, let l, let t): return (f, l, t, nil)
        }
    }

    func makeBody(configuration: Configuration) -> some View {
        let c = colors
        let pressed = configuration.isPressed && isEnabled
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        return configuration.label
            .font(Typo.bodyBold)
            .foregroundStyle(c.text)
            .padding(.horizontal, 18)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: height)
            .background(shape.fill(c.fill))
            .overlay { if let b = c.border { shape.strokeBorder(b, lineWidth: 2) } }
            .contentShape(shape)
            .offset(y: pressed ? 4 : 0)
            .background(shape.fill(c.lip).offset(y: 4))
            .padding(.bottom, 4)
            .animation(.easeOut(duration: 0.12), value: pressed)
    }
}

extension ButtonStyle where Self == ChunkyButtonStyle {
    static var chunky: ChunkyButtonStyle { ChunkyButtonStyle() }
    static func chunky(_ kind: ChunkyKind, height: CGFloat = 52, fullWidth: Bool = true) -> ChunkyButtonStyle {
        ChunkyButtonStyle(kind: kind, height: height, fullWidth: fullWidth)
    }
}

// MARK: - Option tiles (2px line border, radius 14, lip 3)

enum TileState { case normal, selected, correct, wrong, disabled }

struct TileStyle: ButtonStyle {
    var state: TileState = .normal
    var minHeight: CGFloat = 56
    var alignment: Alignment = .leading

    func makeBody(configuration: Configuration) -> some View {
        let (border, fill, text): (Color, Color, Color) = {
            switch state {
            case .normal: return (Palette.line, Palette.paper, Palette.ink)
            case .selected: return (Palette.blue, Palette.blueSoft, Palette.blue)
            case .correct: return (Palette.green, Palette.greenSoft, Palette.greenText)
            case .wrong: return (Palette.red, Palette.redSoft, Palette.redText)
            case .disabled: return (Palette.line, Palette.shelf, Palette.muted.opacity(0.6))
            }
        }()
        let pressed = configuration.isPressed && state != .disabled
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        return configuration.label
            .font(Typo.bodyBold)
            .foregroundStyle(text)
            .multilineTextAlignment(alignment == .leading ? .leading : .center)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: minHeight, alignment: alignment)
            .background(shape.fill(fill))
            .overlay(shape.strokeBorder(border, lineWidth: 2))
            .contentShape(shape)
            .offset(y: pressed ? 3 : 0)
            .background(shape.fill(border).offset(y: 3))
            .padding(.bottom, 3)
            .animation(.easeOut(duration: 0.12), value: pressed)
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

// MARK: - Progress bar (14px, shelf track, highlight stripe)

struct ProgressBar: View {
    var value: Double
    var color: Color = Palette.blue
    var height: CGFloat = 14

    var body: some View {
        GeometryReader { geo in
            let w = max(value > 0 ? height : 0, geo.size.width * min(1, max(0, value)))
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.shelf)
                Capsule().fill(color).frame(width: w)
                    .overlay(alignment: .top) {
                        Capsule().fill(Color.white.opacity(0.3))
                            .frame(width: max(0, w - height), height: 4)
                            .padding(.top, 3)
                    }
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
    var lineWidth: CGFloat = 5
    var body: some View {
        ZStack {
            Circle().stroke(Palette.line, lineWidth: lineWidth)
            Circle().trim(from: 0, to: min(1, progress))
                .stroke(Palette.yellow, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
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
    var lineWidth: CGFloat = 6
    var body: some View {
        ZStack {
            ForEach(0..<5, id: \.self) { i in
                let gap = 0.025
                Circle()
                    .trim(from: Double(i) / 5 + gap, to: Double(i + 1) / 5 - gap)
                    .stroke(i < level ? Palette.yellow : Palette.line, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
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
        let fill = locked ? Palette.lockedFill : color.fill
        let lip = locked ? Palette.lockedLip : color.lip
        let fg = locked ? Palette.muted : color.text
        ZStack {
            LevelRing(level: locked ? 0 : level, diameter: 96, lineWidth: 6)
            ZStack {
                Circle().fill(lip).frame(width: 72, height: 72).offset(y: 6)
                Circle().fill(fill).frame(width: 72, height: 72).offset(y: pressed ? 6 : 0)
                Group {
                    if locked {
                        Image(systemName: "lock.fill").font(.system(size: 24, weight: .bold))
                    } else if isQuotes {
                        Image(systemName: "quote.opening").font(.system(size: 28, weight: .black))
                    } else if level >= 5 {
                        Image(systemName: "checkmark").font(.system(size: 28, weight: .black))
                    } else {
                        Image(systemName: "star.fill").font(.system(size: 28, weight: .black))
                    }
                }
                .foregroundStyle(fg)
                .offset(y: pressed ? 6 : 0)
            }
            .offset(y: -3)
        }
        .frame(width: 100, height: 104)
    }
}

struct PathNodeButtonStyle: ButtonStyle {
    var color: ProjectColor; var level: Int; var locked: Bool; var isQuotes: Bool; var isCurrent: Bool
    func makeBody(configuration: Configuration) -> some View {
        PathNode(color: color, level: level, locked: locked, isQuotes: isQuotes, isCurrent: isCurrent, pressed: configuration.isPressed)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// Small speech-bubble tag above the current node.
struct StartTag: View {
    var text = "Start"
    var color: ProjectColor
    var body: some View {
        VStack(spacing: 0) {
            Text(text)
                .font(Typo.rounded(15, .heavy))
                .foregroundStyle(color == .yellow ? color.text : color.fill)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 12).fill(Palette.paper))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.line, lineWidth: 2))
            Triangle().fill(Palette.line).frame(width: 14, height: 8)
                .overlay(Triangle().fill(Palette.paper).frame(width: 9, height: 5).offset(y: -1.5))
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
        let band = color == .yellow ? Color.black.opacity(0.12) : Color.white.opacity(0.28)
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(color.lip).offset(y: 4)
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(color.fill)
            VStack(spacing: 0) {
                band.frame(height: 3).padding(.top, 14)
                Spacer()
                band.frame(height: 3).padding(.bottom, 30)
            }
            Text(title)
                .font(Typo.rounded(15, .heavy))
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
                        .font(Typo.rounded(9, .bold))
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
            .offset(y: configuration.isPressed ? 3 : 0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
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
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.paper))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
    }
}

struct SectionLabel: View {
    var text: String
    var body: some View {
        Text(text).font(Typo.small).foregroundStyle(Palette.muted)
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
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(Palette.muted)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(label)
    }
}

import SwiftUI
import UIKit

// Every color and font in the app lives in this file (ios/DESIGN.md). Components never hardcode
// hex values. Light tokens follow spencer-web-style, dark tokens follow spencer-app-style section 8.
extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
    static func dynamic(_ light: UInt32, _ dark: UInt32) -> UIColor {
        UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) }
    }
}

private func dyn(_ light: UInt32, _ dark: UInt32) -> Color { Color(uiColor: .dynamic(light, dark)) }

enum Palette {
    // MARK: Ground
    static let bg = dyn(0xFFFFFF, 0x0E0E10)
    static let surface = dyn(0xFFFFFF, 0x17171A)
    /// Quiet fills: inputs, rows, segmented controls.
    static let surfaceDim = dyn(0xF4F4F2, 0x1F1F23)
    /// A raised surface's own outline only, never a divider.
    static let cardEdge = dyn(0xECEEF1, 0x2A2A2F)

    // MARK: Ink
    static let ink = dyn(0x1A1A18, 0xF2F2EF)
    static let ink2 = dyn(0x5A574F, 0xB4B2AC)
    static let ink3 = dyn(0x6D6B63, 0x8C8A84)

    // MARK: Accent: none. Ink is the accent (links, primary button, focus, state).
    static let accent = ink
    static let onAccent = dyn(0xFFFFFF, 0x0E0E10)

    // MARK: Status only
    static let ok = dyn(0x1F7A4D, 0x4CC38A)
    static let warn = dyn(0xB45309, 0xF5A524)
    static let bad = dyn(0xB4372F, 0xF2555A)
    static let okSoft = dyn(0xE9F4EE, 0x13261C)
    static let badSoft = dyn(0xF9ECEA, 0x2C1718)
    static let warnSoft = dyn(0xFBF1E4, 0x2B2213)
    static let onStatus = dyn(0xFFFFFF, 0x0E0E10)

    // MARK: Older names, kept so every screen reads the same tokens.
    static let paper = bg
    static let shelf = surfaceDim
    static let muted = ink3
    static let line = cardEdge
    static let lineStrong = dyn(0xD9D7D0, 0x3A3A40)
    static let blue = accent
    static let blueSoft = surfaceDim
    static let yellow = accent
    static let yellowLip = ink2
    static let yellowSoft = surfaceDim
    static let green = ok
    static let greenSoft = okSoft
    static let greenText = ok
    static let red = bad
    static let redSoft = badSoft
    static let redText = bad
    static let onInk = onAccent
    static let lockedFill = surfaceDim

    /// The owl's own colors (Mascot.swift). Drawn on the page, never on a background.
    enum Owl {
        // Dark mode draws Ollie as a pale snowy owl with dark eyes (designed, not inverted).
        static let body = dyn(0x1A1A18, 0xD9D6CE)
        static let face = dyn(0xFFFFFF, 0xF2F2EF)
        static let eye = dyn(0x1A1A18, 0x17171A)
        static let beak = dyn(0xB8860B, 0xD4B46A)
        static let wing = dyn(0x4A4843, 0x8C8A84)
        static let book = dyn(0x5A574F, 0x8C8A84)
        static let page = dyn(0xF4F4F2, 0x2A2A2F)
    }
}

/// Book spines and lesson nodes use quiet ink tones, not hues (DESIGN.md: no brand accent).
/// The stored color names stay the same so library files keep working on web and iOS.
extension ProjectColor {
    var fill: Color {
        switch self {
        case .ink: return dyn(0x1A1A18, 0xF2F2EF)
        case .blue: return dyn(0x4A4843, 0xB4B2AC)
        case .red: return dyn(0x8C8A84, 0x5E5C57)
        case .green: return dyn(0xD9D6CE, 0x3A3935)
        case .yellow: return dyn(0xECEAE4, 0x2A2A2F)
        }
    }
    var text: Color {
        switch self {
        case .ink, .blue: return dyn(0xFFFFFF, 0x0E0E10)
        case .red: return dyn(0x1A1A18, 0xF2F2EF)
        case .green, .yellow: return dyn(0x1A1A18, 0xF2F2EF)
        }
    }
    /// Light tones get their own outline so they stay visible on the page.
    var edge: Color? {
        switch self {
        case .yellow, .green: return Palette.cardEdge
        default: return nil
        }
    }
}

/// Geist everywhere, Geist Mono for numbers. Every size scales with Dynamic Type.
enum Typo {
    static func geist(_ size: CGFloat, _ weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        let name: String
        switch weight {
        case .bold, .heavy, .black: name = "Geist-Bold"
        case .semibold: name = "Geist-SemiBold"
        case .medium: name = "Geist-Medium"
        default: name = "Geist-Regular"
        }
        return .custom(name, size: size, relativeTo: style)
    }
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .medium, relativeTo style: Font.TextStyle = .body) -> Font {
        let name = weight == .regular ? "GeistMono-Regular" : (weight == .medium ? "GeistMono-Medium" : "GeistMono-SemiBold")
        return .custom(name, size: size, relativeTo: style)
    }
    /// Older call sites ask for "rounded"; they get Geist at the same size, never below 13pt.
    static func rounded(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let w: Font.Weight = (weight == .heavy || weight == .black) ? .semibold : (weight == .bold ? .semibold : weight)
        // 16pt minimum for text; only dense chrome (13pt and below) stays small.
        let sized: CGFloat = size <= 13 ? 13 : max(16, size)
        return geist(sized, w, relativeTo: size >= 22 ? .title2 : (size >= 17 ? .body : .subheadline))
    }

    static let hero = geist(40, .semibold, relativeTo: .largeTitle)
    static let display = geist(32, .semibold, relativeTo: .largeTitle)
    static let title = geist(24, .semibold, relativeTo: .title2)
    static let headline = geist(20, .semibold, relativeTo: .title3)
    static let body = geist(17, .regular, relativeTo: .body)
    static let bodyBold = geist(17, .medium, relativeTo: .body)
    static let small = geist(16, .regular, relativeTo: .callout)
    static let smallBold = geist(16, .medium, relativeTo: .callout)
    /// Dense app chrome only (counts, timestamps).
    static let tiny = geist(13, .medium, relativeTo: .caption)
    static let num = mono(17, .medium)
    /// Book pages and quotes: same face as everything else (no serif, DESIGN.md).
    static func serif(_ size: CGFloat = 19, _ weight: Font.Weight = .regular) -> Font { geist(size, weight == .regular ? .regular : .medium, relativeTo: .body) }

    /// Tight tracking for big Title Case headlines.
    static func tracking(for size: CGFloat) -> CGFloat { size >= 30 ? -size * 0.035 : (size >= 20 ? -size * 0.02 : 0) }
}

enum Motion {
    static let quick = Animation.easeOut(duration: 0.15)
    static let slide = Animation.easeOut(duration: 0.2)
    /// Subtle spring with no visible overshoot.
    static let spring = Animation.spring(response: 0.35, dampingFraction: 0.9)
    static func reduced(_ reduce: Bool, _ a: Animation) -> Animation { reduce ? .easeInOut(duration: 0.2) : a }
}

/// Follow the system, with an override in the settings sheet.
enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var title: String { switch self { case .system: "System"; case .light: "Light"; case .dark: "Dark" } }
    var scheme: ColorScheme? { switch self { case .system: nil; case .light: .light; case .dark: .dark } }
    static let key = "appearance"
}

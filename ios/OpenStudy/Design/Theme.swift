import SwiftUI
import UIKit

// Design tokens from spec section 7.
extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
    static func dynamic(_ light: UInt32, _ dark: UInt32) -> UIColor {
        UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) }
    }
}

enum Palette {
    static let paper = Color(uiColor: .dynamic(0xFFFFFF, 0x101012))
    static let shelf = Color(uiColor: .dynamic(0xF4F3EF, 0x18181B))
    static let ink = Color(uiColor: .dynamic(0x141414, 0xF3F3F3))
    static let muted = Color(uiColor: .dynamic(0x6E6E6E, 0xA0A0A6))
    static let line = Color(uiColor: .dynamic(0xE5E4DF, 0x2A2A2E))
    static let lineStrong = Color(uiColor: .dynamic(0xD3D2CC, 0x3A3A40))

    static let blue = Color(uiColor: UIColor(hex: 0x2F5BEA))
    static let blueLip = Color(uiColor: UIColor(hex: 0x1F43B8))
    static let blueSoft = Color(uiColor: .dynamic(0xEAF0FF, 0x1B2550))
    static let red = Color(uiColor: UIColor(hex: 0xE8423A))
    static let redLip = Color(uiColor: UIColor(hex: 0xB32D27))
    static let redSoft = Color(uiColor: .dynamic(0xFDECEB, 0x3A1513))
    static let redText = Color(uiColor: .dynamic(0xC8322B, 0xFF8A82))
    static let yellow = Color(uiColor: UIColor(hex: 0xFFC531))
    static let yellowLip = Color(uiColor: UIColor(hex: 0xD49B10))
    static let yellowSoft = Color(uiColor: .dynamic(0xFFF6DD, 0x2E2610))
    static let green = Color(uiColor: UIColor(hex: 0x1FA35B))
    static let greenLip = Color(uiColor: UIColor(hex: 0x167A43))
    static let greenSoft = Color(uiColor: .dynamic(0xE6F7EE, 0x10301F))
    static let greenText = Color(uiColor: .dynamic(0x14874A, 0x5FD596))
    static let inkLip = Color(uiColor: .dynamic(0x000000, 0xB8B8BE))
    static let onInk = Color(uiColor: .dynamic(0xFFFFFF, 0x101012))
    static let lockedFill = Color(uiColor: .dynamic(0xE5E4DF, 0x2A2A2E))
    static let lockedLip = Color(uiColor: .dynamic(0xC9C8C2, 0x1E1E22))
}

extension ProjectColor {
    var fill: Color {
        switch self {
        case .blue: return Palette.blue
        case .red: return Palette.red
        case .yellow: return Palette.yellow
        case .green: return Palette.green
        case .ink: return Palette.ink
        }
    }
    var lip: Color {
        switch self {
        case .blue: return Palette.blueLip
        case .red: return Palette.redLip
        case .yellow: return Palette.yellowLip
        case .green: return Palette.greenLip
        case .ink: return Palette.inkLip
        }
    }
    var text: Color {
        switch self {
        case .yellow: return Color(uiColor: UIColor(hex: 0x141414))
        case .ink: return Palette.onInk
        default: return .white
        }
    }
}

enum Typo {
    static func rounded(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .rounded) }
    static let display = Font.system(size: 34, weight: .heavy, design: .rounded)
    static let title = Font.system(size: 24, weight: .heavy, design: .rounded)
    static let headline = Font.system(size: 19, weight: .heavy, design: .rounded)
    static let body = Font.system(size: 17, weight: .regular, design: .rounded)
    static let bodyBold = Font.system(size: 17, weight: .bold, design: .rounded)
    static let small = Font.system(size: 14, weight: .semibold, design: .rounded)
    static let tiny = Font.system(size: 12, weight: .bold, design: .rounded)
    static func serif(_ size: CGFloat = 19, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .serif) }
}

enum Motion {
    static let quick = Animation.easeOut(duration: 0.15)
    static let slide = Animation.easeOut(duration: 0.18)
}

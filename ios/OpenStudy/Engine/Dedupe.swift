import CoreGraphics
import Foundation

// MARK: - Duplicates at import (spec 10.3, ported from BookSaver hash.ts)

public enum ImageHash {
    public static let nearBits = 3

    /// 9x8 grayscale raster (row major) to 16 hex chars: per row 8 bits `left > right`, MSB first.
    public static func dHash(pixels: [Double]) -> String {
        var out = ""
        for row in 0..<8 {
            var v = 0
            for col in 0..<8 { v = (v << 1) | (pixels[row * 9 + col] > pixels[row * 9 + col + 1] ? 1 : 0) }
            out += String(format: "%02x", v)
        }
        return out
    }

    /// The image resized to 9x8 with high quality interpolation, then luminance.
    public static func dHash(_ image: CGImage) -> String? {
        var buf = [UInt8](repeating: 0, count: 9 * 8 * 4)
        let ok: Bool = buf.withUnsafeMutableBytes { raw in
            guard let ctx = CGContext(data: raw.baseAddress, width: 9, height: 8, bitsPerComponent: 8, bytesPerRow: 36,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.interpolationQuality = .high
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: 9, height: 8))
            return true
        }
        guard ok else { return nil }
        // CGContext memory starts at the top row.
        let px = (0..<72).map { i in 0.299 * Double(buf[i * 4]) + 0.587 * Double(buf[i * 4 + 1]) + 0.114 * Double(buf[i * 4 + 2]) }
        return dHash(pixels: px)
    }

    /// Differing bits; Int.max when the lengths differ.
    public static func hamming(_ a: String, _ b: String) -> Int {
        guard a.count == b.count, a.count % 2 == 0 else { return Int.max }
        let x = Array(a), y = Array(b)
        var d = 0
        for i in stride(from: 0, to: x.count, by: 2) {
            guard let p = UInt8(String(x[i...i + 1]), radix: 16), let q = UInt8(String(y[i...i + 1]), radix: 16) else { return Int.max }
            d += (p ^ q).nonzeroBitCount
        }
        return d
    }
}

/// Finds duplicates among the library and the pages of one import (spec 10.3).
public struct DuplicateIndex {
    var keys = Set<String>()
    var images: [(hash: String, stems: Set<String>, short: Bool)] = []

    public init(_ pages: [Page] = []) { for p in pages { insert(p) } }

    static func stems(_ text: String) -> Set<String> { Set(WebText.tokens(text).map(\.stem)) }

    mutating func insert(_ p: Page) {
        if TextKit.wordCount(p.text) >= 8 { keys.insert(Identity.normalizeLookup(p.text)) }
        if let h = p.imageHash { images.append((h, Self.stems(p.text), TextKit.wordCount(p.text) < 8)) }
    }

    /// True when the page is a duplicate; otherwise remembers it and returns false.
    public mutating func isDuplicate(_ p: Page) -> Bool {
        let n = TextKit.wordCount(p.text)
        if n >= 8, keys.contains(Identity.normalizeLookup(p.text)) { return true }
        if let h = p.imageHash {
            let s = Self.stems(p.text)
            for img in images where ImageHash.hamming(h, img.hash) <= ImageHash.nearBits {
                if (n < 8 && img.short) || Self.jaccard(s, img.stems) >= 0.6 { return true }
            }
        }
        insert(p)
        return false
    }

    static func jaccard(_ a: Set<String>, _ b: Set<String>) -> Double {
        let u = a.union(b).count
        return u == 0 ? 1 : Double(a.intersection(b).count) / Double(u)
    }

    /// Splits fresh pages into kept and duplicate counts.
    public mutating func filter(_ pages: [Page]) -> (kept: [Page], duplicates: Int) {
        var kept: [Page] = []
        var dup = 0
        for p in pages { if isDuplicate(p) { dup += 1 } else { kept.append(p) } }
        return (kept, dup)
    }
}

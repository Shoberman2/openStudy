import Compression
import Foundation

/// Minimal ZIP reader (spec 8.2): central directory + local headers, methods 0 (stored) and 8 (deflate).
/// Enough for .pptx and .docx. No ZIP64, no encryption.
public struct ZipArchive {
    public struct Entry { public let name: String; let method: UInt16; let compressedSize: Int; let size: Int; let localOffset: Int }

    public enum ZipError: Error { case notZip, corrupt, unsupported(UInt16) }

    let data: Data
    public let entries: [Entry]

    public init(data: Data) throws {
        self.data = data
        let bytes = [UInt8](data)
        guard bytes.count >= 22 else { throw ZipError.notZip }
        // Find the end of central directory record (signature 0x06054b50), scanning back over a comment.
        var eocd = -1
        var i = bytes.count - 22
        let stop = max(0, bytes.count - 22 - 65_535)
        while i >= stop {
            if bytes[i] == 0x50 && bytes[i + 1] == 0x4B && bytes[i + 2] == 0x05 && bytes[i + 3] == 0x06 { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { throw ZipError.notZip }
        func u16(_ o: Int) -> Int { Int(bytes[o]) | Int(bytes[o + 1]) << 8 }
        func u32(_ o: Int) -> Int { u16(o) | u16(o + 2) << 16 }
        let count = u16(eocd + 10)
        var p = u32(eocd + 16)
        var list: [Entry] = []
        for _ in 0..<count {
            guard p + 46 <= bytes.count, u32(p) == 0x02014b50 else { throw ZipError.corrupt }
            let method = UInt16(u16(p + 10))
            let csize = u32(p + 20), usize = u32(p + 24)
            let nlen = u16(p + 28), xlen = u16(p + 30), clen = u16(p + 32)
            let local = u32(p + 42)
            guard p + 46 + nlen <= bytes.count else { throw ZipError.corrupt }
            let name = String(decoding: bytes[(p + 46)..<(p + 46 + nlen)], as: UTF8.self)
            list.append(Entry(name: name, method: method, compressedSize: csize, size: usize, localOffset: local))
            p += 46 + nlen + xlen + clen
        }
        entries = list
    }

    public var names: [String] { entries.map(\.name) }

    public func data(for name: String) throws -> Data? {
        guard let e = entries.first(where: { $0.name == name }) else { return nil }
        let b = data
        let o = e.localOffset
        guard o + 30 <= b.count else { throw ZipError.corrupt }
        func u16(_ x: Int) -> Int { Int(b[b.startIndex + x]) | Int(b[b.startIndex + x + 1]) << 8 }
        let start = o + 30 + u16(o + 26) + u16(o + 28)
        guard start + e.compressedSize <= b.count else { throw ZipError.corrupt }
        let raw = b.subdata(in: (b.startIndex + start)..<(b.startIndex + start + e.compressedSize))
        switch e.method {
        case 0: return raw
        case 8: return try Self.inflate(raw, expected: e.size)
        default: throw ZipError.unsupported(e.method)
        }
    }

    public func string(for name: String) throws -> String? {
        try data(for: name).map { String(decoding: $0, as: UTF8.self) }
    }

    /// Raw deflate decode. Apple's COMPRESSION_ZLIB is raw DEFLATE (RFC 1951), which is what ZIP stores.
    static func inflate(_ input: Data, expected: Int) throws -> Data {
        if input.isEmpty { return Data() }
        var capacity = max(expected, input.count * 4, 1024)
        for _ in 0..<6 {
            var out = Data(count: capacity)
            let n = out.withUnsafeMutableBytes { dst in
                input.withUnsafeBytes { src in
                    compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, capacity,
                                              src.bindMemory(to: UInt8.self).baseAddress!, input.count, nil, COMPRESSION_ZLIB)
                }
            }
            if n == 0 { throw ZipError.corrupt }
            if n < capacity || (expected > 0 && n == expected) { out.count = n; return out }
            capacity *= 4
        }
        throw ZipError.corrupt
    }

    /// Raw deflate encode, used by the DEBUG fixture writer and tests.
    public static func deflate(_ input: Data) -> Data {
        let cap = input.count + 1024
        var out = Data(count: cap)
        let n = out.withUnsafeMutableBytes { dst in
            input.withUnsafeBytes { src in
                compression_encode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, cap,
                                          src.bindMemory(to: UInt8.self).baseAddress!, input.count, nil, COMPRESSION_ZLIB)
            }
        }
        out.count = n
        return out
    }
}

/// Tiny ZIP writer (stored or deflated entries). Used to build .pptx/.docx fixtures for tests and DEBUG seeding.
public struct ZipWriter {
    private var body = Data()
    private var central = Data()
    private var count = 0

    public init() {}

    static func crc32(_ d: Data) -> UInt32 {
        var table = [UInt32](repeating: 0, count: 256)
        for i in 0..<256 {
            var c = UInt32(i)
            for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1 }
            table[i] = c
        }
        var crc: UInt32 = 0xFFFFFFFF
        for b in d { crc = table[Int((crc ^ UInt32(b)) & 0xFF)] ^ (crc >> 8) }
        return crc ^ 0xFFFFFFFF
    }

    private static func le16(_ v: Int) -> Data { Data([UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF)]) }
    private static func le32(_ v: Int) -> Data { le16(v & 0xFFFF) + le16((v >> 16) & 0xFFFF) }

    public mutating func add(_ name: String, _ content: Data, deflate: Bool = false) {
        let nameData = Data(name.utf8)
        let payload = deflate ? ZipArchive.deflate(content) : content
        let method = deflate ? 8 : 0
        let crc = Int(Self.crc32(content))
        let offset = body.count
        var local = Self.le32(0x04034b50) + Self.le16(20) + Self.le16(0) + Self.le16(method) + Self.le16(0) + Self.le16(0x21)
        local += Self.le32(crc) + Self.le32(payload.count) + Self.le32(content.count) + Self.le16(nameData.count) + Self.le16(0)
        body += local + nameData + payload
        var c = Self.le32(0x02014b50) + Self.le16(20) + Self.le16(20) + Self.le16(0) + Self.le16(method) + Self.le16(0) + Self.le16(0x21)
        c += Self.le32(crc) + Self.le32(payload.count) + Self.le32(content.count) + Self.le16(nameData.count)
        c += Self.le16(0) + Self.le16(0) + Self.le16(0) + Self.le16(0) + Self.le32(0) + Self.le32(offset)
        central += c + nameData
        count += 1
    }

    public mutating func add(_ name: String, _ text: String, deflate: Bool = false) { add(name, Data(text.utf8), deflate: deflate) }

    public func finish() -> Data {
        var end = Self.le32(0x06054b50) + Self.le16(0) + Self.le16(0) + Self.le16(count) + Self.le16(count)
        end += Self.le32(central.count) + Self.le32(body.count) + Self.le16(0)
        return body + central + end
    }
}

import Foundation
import PDFKit
import Photos
import ImageIO
import SwiftUI
import UIKit
import Vision
import UserNotifications

// MARK: - Vision OCR (spec 3.1)

enum OCR {
    /// Recognizes text with geometry, converting Vision's bottom-left boxes to top-left normalized lines.
    static func lines(in image: UIImage) async -> [OCRLine] {
        guard let cg = image.cgImage else { return [] }
        return await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                let req = VNRecognizeTextRequest()
                req.recognitionLevel = .accurate
                req.usesLanguageCorrection = true
                req.recognitionLanguages = ["en-US"]
                let handler = VNImageRequestHandler(cgImage: cg, orientation: image.imageOrientation.cgOrientation)
                do { try handler.perform([req]) } catch { cont.resume(returning: []); return }
                let obs = req.results ?? []
                let lines = obs.compactMap { o -> OCRLine? in
                    guard let t = o.topCandidates(1).first?.string else { return nil }
                    let b = o.boundingBox
                    return OCRLine(text: t, top: Double(1 - b.maxY), bottom: Double(1 - b.minY), left: Double(b.minX), right: Double(b.maxX))
                }
                cont.resume(returning: lines)
            }
        }
    }

    static func page(from image: UIImage) async -> CleanedScreenshot {
        ScreenshotCleaner.clean(await lines(in: image))
    }
}

extension UIImage.Orientation {
    var cgOrientation: CGImagePropertyOrientation {
        switch self {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}

// MARK: - Import queue with progress and cancel (spec 8.2: every format through one pipeline)

struct ImageInput {
    var image: UIImage
    var assetId: String?
    var date: Date?
    var sourceName: String?
    var isScreenshotAsset = false
}

@MainActor
final class Importer: ObservableObject {
    @Published var running = false
    @Published var done = 0
    @Published var total = 0
    @Published var imported = 0
    @Published var skipped = 0
    @Published var message: String?
    @Published var stage = "Reading pages"
    private var cancelled = false
    private var files = 0

    weak var store: Store?

    var progress: Double { total == 0 ? 0 : Double(done) / Double(total) }

    func cancel() { cancelled = true }

    private func begin(total: Int, stage: String = "Reading pages") {
        running = true; cancelled = false; done = 0; imported = 0; skipped = 0; files = 0; message = nil
        self.total = total; self.stage = stage
    }

    private func finish(kind: String) {
        running = false
        store?.library.log("import", ["kind": .string(kind), "count": .number(Double(imported)), "skipped": .number(Double(skipped))])
        var m = "Added \(imported) \(imported == 1 ? "page" : "pages")"
        if files > 1 { m += " from \(files) files" }
        m += "."
        if skipped > 0 { m += " \(skipped) had no readable text." }
        if cancelled { m += " Stopped early." }
        message = m
    }

    private func add(_ page: Page) {
        store?.library.pages.append(page)
        imported += 1
    }

    // MARK: Images (screenshots, photos, whiteboards, scans)

    static func looksLikePhonePage(_ img: UIImage) -> Bool {
        let w = img.size.width, h = img.size.height
        guard w > 0, h > w else { return false }
        let r = h / w
        return r >= 1.9 && r <= 2.35
    }

    /// Reads one image. Smart organize (Claude vision via /api/read) first when available, else Vision.
    @discardableResult
    func ingest(_ input: ImageInput) async -> Bool {
        guard let store else { return false }
        let img = input.image
        var text = ""
        var heading: String?
        var header: String?
        var kind = "photo"
        let phone = input.isScreenshotAsset || Self.looksLikePhonePage(img)
        if store.smartOn, let client = store.smartClient, let read = await client.read(img) {
            text = read.text; heading = read.heading
            if phone && ScreenshotCleaner.isBookText(text) { kind = "screenshot" }
        } else {
            let lines = await OCR.lines(in: img)
            if phone {
                let cleaned = ScreenshotCleaner.clean(lines)
                if cleaned.isBookPage { kind = "screenshot"; text = cleaned.body; header = cleaned.header }
            }
            if kind == "photo" {
                text = PhotoText.join(lines.filter { !ScreenshotCleaner.isNoise($0.text) || TextKit.wordCount($0.text) > 2 })
                heading = DocumentParser.guessHeading(text)
            }
        }
        // Photos are never skipped as "not a book page"; only when there is (almost) no text.
        guard TextKit.wordCount(text) >= 5 else { skipped += 1; return false }
        let id = IDGen.make()
        let file = store.saveImage(img, id: id)
        add(Page(id: id, kind: kind, text: text, header: header, image: file, assetId: input.assetId,
                 createdAt: ISO.string(input.date ?? Date()), sourceName: input.sourceName, heading: kind == "photo" ? heading : nil))
        return true
    }

    func importImages(_ inputs: [ImageInput], kind: String = "photo") async {
        guard let store else { return }
        let known = store.knownAssetIds
        let fresh = inputs.filter { $0.assetId.map { !known.contains($0) } ?? true }
        begin(total: fresh.count)
        for item in fresh {
            if cancelled { break }
            await ingest(item)
            done += 1
        }
        finish(kind: kind)
    }

    /// PhotosPicker results (any photo or screenshot).
    func importPicked(_ items: [(data: Data, assetId: String?)]) async {
        let inputs = items.compactMap { item -> ImageInput? in
            guard let img = UIImage(data: item.data) else { return nil }
            return ImageInput(image: img, assetId: item.assetId, date: Self.exifDate(item.data))
        }
        skipped += items.count - inputs.count
        await importImages(inputs, kind: "photo")
    }

    /// VisionKit document camera pages (perspective corrected).
    func importScans(_ images: [UIImage]) async {
        let f = DateFormatter(); f.dateFormat = "MMM d, h:mm a"
        let name = "Scan \(f.string(from: Date()))"
        await importImages(images.map { ImageInput(image: $0, date: Date(), sourceName: name) }, kind: "scan")
    }

    static func exifDate(_ data: Data) -> Date? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any],
              let s = exif[kCGImagePropertyExifDateTimeOriginal] as? String else { return nil }
        let f = DateFormatter(); f.dateFormat = "yyyy:MM:dd HH:mm:ss"
        return f.date(from: s)
    }

    /// "Scan my Screenshots album": PhotoKit screenshots not yet imported, batches of 20.
    func scanScreenshotsAlbum() async {
        guard let store else { return }
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard status == .authorized || status == .limited else {
            message = "Photo access is off. Turn it on in Settings to scan screenshots."
            return
        }
        let opts = PHFetchOptions()
        opts.predicate = NSPredicate(format: "(mediaSubtypes & %d) != 0", PHAssetMediaSubtype.photoScreenshot.rawValue)
        opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        let result = PHAsset.fetchAssets(with: .image, options: opts)
        let known = store.knownAssetIds
        var assets: [PHAsset] = []
        result.enumerateObjects { a, _, _ in if !known.contains(a.localIdentifier) { assets.append(a) } }
        guard !assets.isEmpty else { message = "No new screenshots found."; return }
        begin(total: assets.count)
        let manager = PHImageManager.default()
        let req = PHImageRequestOptions()
        req.deliveryMode = .highQualityFormat
        req.isNetworkAccessAllowed = true
        req.isSynchronous = false
        var index = 0
        while index < assets.count, !cancelled {
            let batch = assets[index..<min(assets.count, index + 20)]
            for a in batch {
                if cancelled { break }
                let img: UIImage? = await withCheckedContinuation { cont in
                    var resumed = false
                    manager.requestImage(for: a, targetSize: CGSize(width: 1400, height: 3000), contentMode: .aspectFit, options: req) { image, info in
                        let degraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
                        if !degraded && !resumed { resumed = true; cont.resume(returning: image) }
                    }
                }
                if let img { await ingest(ImageInput(image: img, assetId: a.localIdentifier, date: a.creationDate, isScreenshotAsset: true)) } else { skipped += 1 }
                done += 1
            }
            index += 20
        }
        finish(kind: "screenshot")
    }

    // MARK: Text

    func importText(_ text: String, kind: String = "note") -> Int {
        guard let store else { return 0 }
        let pages = NotesParser.pages(from: text)
        store.addPages(pages, kind: kind, skipped: 0)
        message = "Added \(pages.count) \(pages.count == 1 ? "page" : "pages")."
        return pages.count
    }

    // MARK: Files (pdf, pptx, docx, txt, md, html, images)

    static let imageExts: Set<String> = ["jpg", "jpeg", "png", "heic", "heif", "tif", "tiff", "gif", "webp", "bmp"]

    func importFiles(_ urls: [URL]) async {
        begin(total: urls.count, stage: "Reading files")
        var unsupported: [String] = []
        for url in urls {
            if cancelled { break }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let name = url.lastPathComponent
            let ext = url.pathExtension.lowercased()
            let before = imported
            stage = "Reading \(name)"
            switch ext {
            case "pdf": await importPDF(url, name: name)
            case "pptx": importOffice(url, name: name, kind: "slides", parse: DocumentParser.pptx)
            case "docx": importOffice(url, name: name, kind: "doc", parse: DocumentParser.docx)
            case "txt", "md", "markdown", "text", "html", "htm": importTextFile(url, name: name, ext: ext)
            case _ where Self.imageExts.contains(ext):
                if let data = try? Data(contentsOf: url), let img = UIImage(data: data) {
                    await ingest(ImageInput(image: img, date: Self.exifDate(data), sourceName: name))
                } else { skipped += 1 }
            default:
                unsupported.append(name)
            }
            if imported > before { files += 1 } else if !unsupported.contains(name) && !Self.imageExts.contains(ext) { skipped += 1 }
            done += 1
        }
        finish(kind: "file")
        if !unsupported.isEmpty {
            message = (message ?? "") + " Not supported: \(unsupported.joined(separator: ", ")). Export Keynote or Google Slides to .pptx or .pdf."
        }
    }

    func importPDF(_ url: URL, name: String) async {
        guard let doc = PDFDocument(url: url) else { return }
        var meta = (doc.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String)?.trimmingCharacters(in: .whitespaces)
        if let m = meta, m.isEmpty || m.lowercased().hasPrefix("microsoft") || m.lowercased() == "untitled" || m.hasSuffix(".pdf") { meta = nil }
        for i in 0..<doc.pageCount {
            if cancelled { break }
            guard let page = doc.page(at: i) else { continue }
            var text = page.string ?? ""
            var image: UIImage?
            if text.trimmingCharacters(in: .whitespacesAndNewlines).count < 20 {
                // Scanned page: render at 2x and OCR it.
                let b = page.bounds(for: .mediaBox)
                let img = page.thumbnail(of: CGSize(width: b.width * 2, height: b.height * 2), for: .mediaBox)
                text = PhotoText.join(await OCR.lines(in: img))
                image = img
            }
            text = DocumentParser.unwrapLines(text.replacingOccurrences(of: "\r", with: "\n"))
            guard TextKit.wordCount(text) >= 5 else { continue }
            let id = IDGen.make()
            let file = image.flatMap { store?.saveImage($0, id: id) }
            add(Page(id: id, kind: "pdf", text: text, header: meta, image: file, sourceName: name, sourceIndex: i + 1,
                     heading: DocumentParser.guessHeading(text)))
        }
    }

    func importOffice(_ url: URL, name: String, kind: String, parse: (Data) throws -> ExtractedDoc) {
        guard let data = try? Data(contentsOf: url), let doc = try? parse(data) else { return }
        for p in doc.pages {
            add(Page(kind: kind, text: p.text, header: doc.title, sourceName: name, sourceIndex: p.index, heading: p.heading))
        }
    }

    func importTextFile(_ url: URL, name: String, ext: String) {
        guard let raw = (try? String(contentsOf: url, encoding: .utf8)) ?? (try? String(contentsOf: url, encoding: .isoLatin1)) else { return }
        let text = ext.hasPrefix("htm") ? DocumentParser.htmlToMarkdown(raw) : raw
        if !text.lowercased().contains("excerpt from"), let doc = DocumentParser.markdownSections(text), !doc.pages.isEmpty {
            for p in doc.pages { add(Page(kind: "doc", text: p.text, header: doc.title, sourceName: name, sourceIndex: p.index, heading: p.heading)) }
            return
        }
        for (i, var p) in NotesParser.pages(from: text).enumerated() {
            if p.verbatim != true { p.sourceName = name; p.sourceIndex = i + 1 }
            add(p)
        }
    }
}

// MARK: - Daily reminder

enum Reminders {
    static let id = "openstudy.daily"

    static func request() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    static func schedule(_ hhmm: String?) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [id])
        guard let hhmm, let (h, m) = parse(hhmm) else { return }
        let content = UNMutableNotificationContent()
        content.title = "Time for a quick lesson"
        content.body = "A few minutes keeps your streak going and your books fresh."
        content.sound = .default
        let trigger = UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: h, minute: m), repeats: true)
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }

    static func parse(_ s: String) -> (Int, Int)? {
        let p = s.split(separator: ":").compactMap { Int($0) }
        guard p.count == 2 else { return nil }
        return (p[0], p[1])
    }

    static func string(from date: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 20, c.minute ?? 0)
    }

    static func date(from s: String?) -> Date {
        let (h, m) = s.flatMap(parse) ?? (20, 0)
        return Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: Date()) ?? Date()
    }
}

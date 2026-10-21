import Foundation
import PDFKit
import PhotosUI
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

    /// Fast text check for the Photos sweep (spec 9.2): `.fast`, no language correction, word count only.
    static func quickWordCount(_ image: UIImage) async -> Int {
        guard let cg = image.cgImage else { return 0 }
        return await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                let req = VNRecognizeTextRequest()
                req.recognitionLevel = .fast
                req.usesLanguageCorrection = false
                let handler = VNImageRequestHandler(cgImage: cg, orientation: image.imageOrientation.cgOrientation)
                do { try handler.perform([req]) } catch { cont.resume(returning: 0); return }
                let n = (req.results ?? []).reduce(0) { $0 + TextKit.wordCount($1.topCandidates(1).first?.string ?? "") }
                cont.resume(returning: n)
            }
        }
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
    /// Photos sweep counters (spec 9.2): photos checked and photos that had notes.
    @Published var sweeping = false
    @Published var found = 0
    private var cancelled = false
    private var files = 0
    private var notesAlready = 0
    private var duplicates = 0
    private var dupIndex = DuplicateIndex()

    weak var store: Store?

    var progress: Double { total == 0 ? 0 : Double(done) / Double(total) }

    func cancel() { cancelled = true }

    static let grouped: NumberFormatter = { let f = NumberFormatter(); f.numberStyle = .decimal; f.usesGroupingSeparator = true; return f }()
    static func count(_ n: Int) -> String { grouped.string(from: NSNumber(value: n)) ?? "\(n)" }

    /// "Checked 1,240 of 8,000 photos. Found 96 with notes."
    var sweepText: String { "Checked \(Self.count(done)) of \(Self.count(total)) photos. Found \(Self.count(found)) with notes." }

    private func begin(total: Int, stage: String = "Reading pages") {
        running = true; cancelled = false; done = 0; imported = 0; skipped = 0; files = 0; found = 0; notesAlready = 0; duplicates = 0; message = nil
        dupIndex = DuplicateIndex(store?.library.pages ?? [])
        self.total = total; self.stage = stage
    }

    /// Ends an import and logs it (spec 12.3): `kind` is the source, `extra` adds category props such as file `types`.
    private func finish(kind: String, extra: [String: JSONValue] = [:]) {
        running = false
        let props: [String: JSONValue] = ["kind": .string(kind), "count": .number(Double(imported)), "skipped": .number(Double(skipped)), "duplicates": .number(Double(duplicates))]
        store?.library.log("import", props.merging(extra) { $1 })
        var m = "Added \(imported) \(imported == 1 ? "page" : "pages")"
        if files > 1 { m += " from \(files) files" }
        m += "."
        if skipped > 0 { m += " \(skipped) had no readable text." }
        if duplicates > 0 { m += " \(duplicates) \(duplicates == 1 ? "was a duplicate" : "were duplicates")." }
        if notesAlready > 0 { m += " \(notesAlready) \(notesAlready == 1 ? "note was" : "notes were") already here." }
        if cancelled { m += " Stopped early." }
        message = m
    }

    /// Adds a page unless it duplicates one in the library or earlier in this import (spec 10.3).
    @discardableResult
    private func add(_ page: Page) -> Bool {
        if dupIndex.isDuplicate(page) { duplicates += 1; return false }
        store?.library.pages.append(page)
        imported += 1
        return true
    }

    // MARK: Images (screenshots, photos, whiteboards, scans)

    static func looksLikePhonePage(_ img: UIImage) -> Bool {
        let w = img.size.width, h = img.size.height
        guard w > 0, h > w else { return false }
        let r = h / w
        return r >= 1.9 && r <= 2.35
    }

    /// A read page waiting to be added, with the image it came from.
    struct ReadPage { var page: Page; var image: UIImage }

    /// Reads and adds one image.
    @discardableResult
    func ingest(_ input: ImageInput) async -> Bool {
        guard let r = await read(input) else { return false }
        return commit(r)
    }

    /// Reads one image. Smart organize (Claude vision via /api/read) first when available, else Vision.
    /// Nothing is added yet, so several reads can run at once and still land in order.
    func read(_ input: ImageInput) async -> ReadPage? {
        guard let store else { return nil }
        let img = input.image
        var text = ""
        var heading: String?
        var header: String?
        var pageNumber: Int?
        var kind = "photo"
        // Raw OCR lines, one per line: the word-list check runs on these, before paragraphs are joined (spec 10.2).
        var rawLines: String?
        let phone = input.isScreenshotAsset || Self.looksLikePhonePage(img)
        if store.smartOn, let client = store.smartClient, let read = await client.read(img) {
            text = read.text; heading = read.heading
            if phone && ScreenshotCleaner.isBookText(text) { kind = "screenshot" }
        } else {
            let lines = await OCR.lines(in: img)
            rawLines = lines.map(\.text).filter { !ScreenshotCleaner.isNoise($0) }.joined(separator: "\n")
            if phone {
                let cleaned = ScreenshotCleaner.clean(lines)
                if cleaned.isBookPage { kind = "screenshot"; text = cleaned.body; header = cleaned.header; pageNumber = cleaned.pageNumber }
            }
            if kind == "photo" {
                text = PhotoText.join(lines.filter { !ScreenshotCleaner.isNoise($0.text) || TextKit.wordCount($0.text) > 2 })
                heading = DocumentParser.guessHeading(text)
            }
        }
        // Photos are never skipped as "not a book page"; only when there is (almost) no text.
        guard TextKit.wordCount(text) >= 5 else { skipped += 1; return nil }
        let id = IDGen.make()
        var page = Page(id: id, kind: kind, text: text, header: header, assetId: input.assetId,
                        createdAt: ISO.string(input.date ?? Date()), sourceName: input.sourceName, heading: kind == "photo" ? heading : nil,
                        imageHash: img.cgImage.flatMap(ImageHash.dHash), pageNumber: pageNumber)
        // A photo of a vocabulary list becomes one word-list page (spec 10.2).
        let source = rawLines ?? text
        let list = WordList.parse(source, title: input.sourceName)
        if list.isWordList { page.text = WordList.pageText(source); page.words = list.words; page.heading = Grouper.words }
        return ReadPage(page: page, image: img)
    }

    /// Adds a read page unless it duplicates one already here (spec 10.3).
    @discardableResult
    func commit(_ r: ReadPage) -> Bool {
        guard let store else { return false }
        var page = r.page
        if dupIndex.isDuplicate(page) { duplicates += 1; return false }
        page.image = store.saveImage(r.image, id: page.id)
        store.library.pages.append(page)
        imported += 1
        return true
    }

    /// Images read at once. Vision runs each read on its own thread, so this is most of the speedup.
    static let readWidth = min(4, max(2, ProcessInfo.processInfo.activeProcessorCount / 2))

    /// Loads and reads a batch at once, returning reads in input order. `load` returns nil when
    /// there is nothing to read (an unreadable file, or a photo with no notes).
    private func readBatch<T>(_ items: ArraySlice<T>, load: @escaping (T) async -> ImageInput?) async -> [ReadPage?] {
        await withTaskGroup(of: (Int, ReadPage?).self) { group in
            for (i, item) in items.enumerated() {
                group.addTask {
                    guard let input = await load(item) else { return (i, nil) }
                    return (i, await self.read(input))
                }
            }
            var out = [ReadPage?](repeating: nil, count: items.count)
            for await (i, r) in group { out[i] = r }
            return out
        }
    }

    /// Reads `items` a batch at a time, adding each page in order and counting progress.
    private func readAll<T>(_ items: [T], load: @escaping (T) async -> ImageInput?, added: (T, Bool) -> Void = { _, _ in }) async {
        var start = 0
        while start < items.count, !cancelled {
            let batch = items[start..<min(start + Self.readWidth, items.count)]
            let reads = await readBatch(batch, load: load)
            for (item, r) in zip(batch, reads) {
                added(item, r.map(commit) ?? false)
                done += 1
            }
            start += batch.count
        }
    }

    func importImages(_ inputs: [ImageInput], kind: String = "photo") async {
        guard let store else { return }
        let known = store.knownAssetIds
        let fresh = inputs.filter { $0.assetId.map { !known.contains($0) } ?? true }
        begin(total: fresh.count)
        await readAll(fresh) { $0 }
        finish(kind: kind)
    }

    /// PhotosPicker results (any photo or screenshot). The progress screen shows right away;
    /// photos load from the library (or iCloud) inside the reading batches.
    func importPicked(_ items: [PhotosPickerItem]) async {
        guard let store else { return }
        let known = store.knownAssetIds
        let fresh = items.filter { $0.itemIdentifier.map { !known.contains($0) } ?? true }
        begin(total: fresh.count, stage: "Reading your photos")
        await readAll(fresh) { item in
            guard let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) else {
                await self.noteUnreadable()
                return nil
            }
            return ImageInput(image: img, assetId: item.itemIdentifier, date: Self.exifDate(data))
        }
        finish(kind: "photo")
    }

    private func noteUnreadable() { skipped += 1 }

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

    static func requestImage(_ asset: PHAsset, size: CGSize, fast: Bool) async -> UIImage? {
        let req = PHImageRequestOptions()
        // Always the real image at the requested size: `.fastFormat` hands back a tiny cached thumbnail
        // that has no readable text, so the sweep found nothing (spec 9.2).
        req.deliveryMode = .highQualityFormat
        req.resizeMode = fast ? .fast : .exact
        req.isNetworkAccessAllowed = true
        req.isSynchronous = false
        return await withCheckedContinuation { cont in
            var resumed = false
            PHImageManager.default().requestImage(for: asset, targetSize: size, contentMode: .aspectFit, options: req) { image, info in
                let degraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
                if !degraded && !resumed { resumed = true; cont.resume(returning: image) }
            }
        }
    }

    /// Long side of the fast-pass image (spec 9.2). At 720 a vocab list barely clears 25 words; 1080 leaves room.
    static let detectSide: CGFloat = 1080

    /// "Find notes in Photos" (spec 9.2): every image, newest first, skipping photos already checked.
    /// A fast pass on a small image finds photos with >= 25 words; only those are read fully.
    func findNotesInPhotos() async {
        guard let store else { return }
        // Show the progress screen at once: asking for access and listing a big library take a moment.
        begin(total: 0, stage: "Opening your photos")
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard status == .authorized || status == .limited else {
            running = false
            message = "Photo access is off. Turn it on in Settings to find notes in your photos."
            return
        }
        let opts = PHFetchOptions()
        opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        let result = PHAsset.fetchAssets(with: .image, options: opts)
        var checked = store.loadScannedAssetIds()
        let known = store.knownAssetIds.union(checked)
        var assets: [PHAsset] = []
        result.enumerateObjects { a, _, _ in if !known.contains(a.localIdentifier) { assets.append(a) } }
        guard !assets.isEmpty else { running = false; message = "No new photos to check."; return }
        total = assets.count
        stage = "Finding notes in your photos"
        sweeping = true
        defer { sweeping = false }
        await readAll(assets, load: { a in
            guard let small = await Self.requestImage(a, size: CGSize(width: Self.detectSide, height: Self.detectSide), fast: true),
                  await OCR.quickWordCount(small) >= 25,
                  let full = await Self.requestImage(a, size: CGSize(width: 1400, height: 3000), fast: false) else { return nil }
            return ImageInput(image: full, assetId: a.localIdentifier, date: a.creationDate, isScreenshotAsset: a.mediaSubtypes.contains(.photoScreenshot))
        }, added: { a, added in
            if added { found += 1 }
            checked.insert(a.localIdentifier)
            if (done + 1) % 50 == 0 { store.saveScannedAssetIds(checked) }
        })
        store.saveScannedAssetIds(checked)
        store.library.log("library_scan", ["source": "photos", "checked": .number(Double(done)), "found": .number(Double(found))])
        let summary = sweepText
        finish(kind: "photo", extra: ["source": .string("sweep")])
        message = summary + (cancelled ? " Stopped early. Run it again to pick up where you left off." : "")
    }

    // MARK: Text

    func importText(_ text: String, kind: String = "paste") -> Int {
        guard let store else { return 0 }
        if AppleNotes.hasBridgeMarker(text) { return importNotes(AppleNotes.parseBridgeText(text), kind: "notes_app") }
        let pages = NotesParser.pages(from: text)
        let added = store.addPages(pages, kind: pages.contains { $0.words != nil } ? "words" : kind, skipped: 0)
        let dup = pages.count - added
        message = "Added \(added) \(added == 1 ? "page" : "pages")." + (dup > 0 ? " \(dup) \(dup == 1 ? "was a duplicate" : "were duplicates")." : "")
        return added
    }

    /// Apple Notes from the Mac export file or the iPhone Shortcut (spec 9.2, 9.3). Notes already here are skipped.
    @discardableResult
    func importNotes(_ notes: [AppleNote], kind: String) -> Int {
        guard let store else { return 0 }
        let r = AppleNotes.importNotes(notes, known: Set(store.library.pages.compactMap(\.noteId)))
        let added = store.addPages(r.pages, kind: kind, skipped: r.already)
        let dup = r.pages.count - added
        // Duplicates were not kept, so the summary counts only the pages that were added.
        var kept = r
        kept.pages = Array(r.pages.prefix(added))
        message = r.notes == 0 && r.already == 0 ? "No notes with enough text to study." : kept.summary + (dup > 0 ? " \(dup) \(dup == 1 ? "was a duplicate" : "were duplicates")." : "")
        return added
    }

    /// `openstudy://import-notes`: the Shortcut copied every note to the clipboard.
    func importNotesFromClipboard() {
        guard let text = UIPasteboard.general.string, AppleNotes.hasBridgeMarker(text) else {
            message = "No notes on the clipboard. Run the OpenStudy Shortcut again."
            return
        }
        importNotes(AppleNotes.parseBridgeText(text), kind: "notes_app")
    }

    // MARK: Files (pdf, pptx, docx, txt, md, html, images, Apple Notes export)

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
            case "json":
                if let data = try? Data(contentsOf: url), let export = NotesExport.decode(data) {
                    let r = AppleNotes.importNotes(export.notes, known: Set((store?.library.pages ?? []).compactMap(\.noteId)))
                    for p in r.pages { add(p) }
                    skipped += r.empty
                    notesAlready += r.already
                } else { unsupported.append(name) }
            case _ where Self.imageExts.contains(ext):
                if let data = try? Data(contentsOf: url), let img = UIImage(data: data) {
                    await ingest(ImageInput(image: img, date: Self.exifDate(data), sourceName: name))
                } else { skipped += 1 }
            default:
                unsupported.append(name)
            }
            if imported > before { files += 1 } else if !unsupported.contains(name) && !Self.imageExts.contains(ext) && ext != "json" { skipped += 1 }
            done += 1
        }
        finish(kind: "files", extra: ["types": .string(Usage.types(urls.map(\.pathExtension)))])
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
        if !ext.hasPrefix("htm"), WordList.parse(text, title: name).isWordList {
            for p in NotesParser.pages(from: text, title: name) { var q = p; q.sourceName = name; q.sourceIndex = 1; add(q) }
            return
        }
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

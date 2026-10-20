import Photos
import UIKit
import XCTest
@testable import OpenStudy

/// Real images through real Vision OCR and the app's import path (Importer.ingest), on the simulator.
/// Media/ is rendered by Media/make.py: three Apple Books style pages of one book (p. 12 to 14),
/// an exact copy and a re-encoded copy, a whiteboard photo, a vocab list and a photo with no text.
@MainActor
final class ImageImportTests: XCTestCase {
    private func image(_ name: String) throws -> UIImage {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: nil), "missing \(name)")
        return try XCTUnwrap(UIImage(contentsOfFile: url.path))
    }

    private func importer() -> (Store, Importer) {
        let store = Store(persist: false)
        store.library = Library()
        store.library.profile.onboarded = true
        let importer = Importer()
        importer.store = store
        return (store, importer)
    }

    func testScreenshotsPhotosAndDuplicates() async throws {
        let (store, importer) = importer()
        let names = ["book_p12.png", "book_p13.png", "book_p14.png", "book_p12_copy.png", "book_p13_reencoded.jpg", "whiteboard.jpg", "vocab.png", "landscape.jpg"]
        let inputs = try names.map { ImageInput(image: try image($0), sourceName: $0) }
        await importer.importImages(inputs)

        let pages = store.library.pages
        XCTAssertEqual(pages.count, 5, pages.map { "\($0.kind) \($0.text.prefix(40))" }.joined(separator: " | "))
        XCTAssertEqual(importer.message, "Added 5 pages. 1 had no readable text. 2 were duplicates.")

        let book = pages.filter { $0.kind == "screenshot" && $0.words == nil }
        XCTAssertEqual(book.count, 3)
        XCTAssertEqual(Set(book.compactMap(\.header)), ["Atomic Habits"])
        XCTAssertEqual(book.compactMap(\.pageNumber).sorted(), [12, 13, 14])
        XCTAssertTrue(book.allSatisfy { $0.imageHash?.count == 16 && $0.image != nil })
        XCTAssertTrue(book.contains { $0.text.hasPrefix("Habits are the compound interest of self-improvement.") })
        XCTAssertFalse(book.contains { $0.text.contains("9:41") || $0.text.contains("Page 12") })

        let words = try XCTUnwrap(pages.first { $0.words != nil })
        XCTAssertEqual(words.words?.map(\.term), ["ephemeral", "laconic", "obsequious", "sonder", "petrichor"])
        XCTAssertEqual(words.words?.first?.definition, "lasting a very short time")
        XCTAssertEqual(words.words?.first { $0.term == "obsequious" }?.definition, "too eager to please")

        let photo = try XCTUnwrap(pages.first { $0.kind == "photo" && $0.words == nil })
        XCTAssertTrue(photo.text.lowercased().contains("calvin cycle"), photo.text)

        // Sort sees one book, one topic and one word list.
        let groups = Grouper.group(store.library.inbox)
        XCTAssertEqual(Grouper.detectionSummary(groups), "Looks like 1 book, 1 topic and 1 word list.")
        let bookGroup = try XCTUnwrap(groups.first { $0.title == "Atomic Habits" })
        XCTAssertEqual(bookGroup.pageIds.count, 3)

        // Importing the same images again adds nothing.
        await importer.importImages(try ["book_p12.png", "vocab.png"].map { ImageInput(image: try image($0)) })
        XCTAssertEqual(store.library.pages.count, 5)
        XCTAssertEqual(importer.message, "Added 0 pages. 2 were duplicates.")
    }

    /// "Find notes in Photos" against the simulator's real photo library. Needs the media added with
    /// `xcrun simctl addmedia booted ...` and photo access granted to com.openstudy.shelf; skipped otherwise.
    func testFindNotesInPhotos() async throws {
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized else {
            throw XCTSkip("Photo access not granted to the host app")
        }
        let all = PHAsset.fetchAssets(with: .image, options: nil)
        guard all.count >= 8 else { throw XCTSkip("Photo library has \(all.count) images; add the test media first") }
        let (store, importer) = importer()
        await importer.findNotesInPhotos()
        let message = try XCTUnwrap(importer.message)
        XCTAssertTrue(message.hasPrefix("Checked \(all.count) of \(all.count) photos. Found "), message)
        let pages = store.library.pages
        XCTAssertTrue(pages.contains { $0.header == "Atomic Habits" && $0.pageNumber == 12 }, message)
        XCTAssertTrue(pages.allSatisfy { $0.assetId != nil })
        XCTAssertTrue(pages.contains { $0.words?.count == 5 }, message)
        // Duplicates of a page already found are not added twice.
        XCTAssertEqual(pages.filter { $0.pageNumber == 12 }.count, 1)
        XCTAssertTrue(store.library.events.contains { $0.name == "library_scan" })
    }

    func testShortcutClipboardImport() throws {
        let (store, importer) = importer()
        UIPasteboard.general.string = Self.bridgeText
        importer.importNotesFromClipboard()
        XCTAssertEqual(importer.message, "Added 2 pages from 2 notes.")
        XCTAssertEqual(store.library.pages.compactMap(\.noteId).count, 2)
        XCTAssertEqual(store.library.pages.first { $0.words != nil }?.words?.count, 3)
        importer.importNotesFromClipboard()
        XCTAssertEqual(importer.message, "Nothing new. All 2 notes were already here.")
        XCTAssertEqual(store.library.pages.count, 2)
    }

    func testAppleNotesExportFile() async throws {
        let (store, importer) = importer()
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "apple-notes", withExtension: "json"))
        await importer.importFiles([url])
        XCTAssertEqual(store.library.pages.count, 15, importer.message ?? "")
        XCTAssertTrue(importer.message?.hasPrefix("Added 15 pages.") ?? false, importer.message ?? "")
    }

    static let bridgeText = """
    === OpenStudy note ===
    Title: Stoicism
    Folder: Philosophy
    Stoicism
    Virtue is the only good, said the Stoics, and reason is our guide through every hardship we face in life.
    === OpenStudy note ===
    Title: Vocab
    Folder:
    sonder - realizing others have full lives
    limerence - the state of being infatuated
    petrichor - the smell of rain on dry earth
    """
}

import UIKit
import XCTest
@testable import OpenStudy

/// The Photos sweep's fast pass (spec 9.2) at the size it requests: every note photo clears 25 words,
/// a photo without text does not. (Regression: it used to get PhotoKit's tiny cached thumbnail and found nothing.)
@MainActor
final class SweepDetectTests: XCTestCase {
    func testFastPassFindsNotePhotosAtDetectSize() async throws {
        for (name, isNote) in [("book_p12.png", true), ("whiteboard.jpg", true), ("vocab.png", true), ("landscape.jpg", false)] {
            let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: nil))
            let img = try XCTUnwrap(UIImage(contentsOfFile: url.path))
            let s = Importer.detectSide / max(img.size.width, img.size.height)
            let size = CGSize(width: img.size.width * s, height: img.size.height * s)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let small = UIGraphicsImageRenderer(size: size, format: format).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
            let words = await OCR.quickWordCount(small)
            XCTAssertEqual(words >= 25, isNote, "\(name): \(words) words")
        }
    }
}

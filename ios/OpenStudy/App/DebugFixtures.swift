#if DEBUG
import SwiftUI
import UIKit

/// DEBUG-only: generates a .pptx, a typed .pdf, a scanned-image .pdf and a handwriting-style whiteboard photo,
/// writes them to a temp folder and runs them through the real file import pipeline (`-seedFiles`).
enum DebugFixtures {
    static func slide(_ title: String, _ body: [String]) -> String {
        let esc: (String) -> String = { $0.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
        var x = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"><p:cSld><p:spTree>"
        x += "<p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Title 1\"/><p:cNvSpPr/><p:nvPr><p:ph type=\"title\"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>\(esc(title))</a:t></a:r></a:p></p:txBody></p:sp>"
        x += "<p:sp><p:nvSpPr><p:cNvPr id=\"3\" name=\"Content 2\"/><p:cNvSpPr/><p:nvPr><p:ph idx=\"1\"/></p:nvPr></p:nvSpPr><p:txBody>"
        for b in body { x += "<a:p><a:r><a:t>\(esc(b))</a:t></a:r></a:p>" }
        x += "</p:txBody></p:sp></p:spTree></p:cSld></p:sld>"
        return x
    }

    static func pptx() -> Data {
        var z = ZipWriter()
        z.add("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>")
        z.add("docProps/core.xml", "<cp:coreProperties xmlns:cp=\"cp\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:title>CHEM 110: Atoms and Elements</dc:title></cp:coreProperties>")
        z.add("ppt/slides/slide1.xml", slide("CHEM 110: General Chemistry", ["Lecture 3: Atoms and Elements", "Professor Rivera, Fall term"]), deflate: true)
        z.add("ppt/slides/slide2.xml", slide("Inside the Atom", [
            "Proton: a positively charged particle in the nucleus of an atom",
            "Neutron: a particle with no charge found in the nucleus",
            "Electron: a negatively charged particle that orbits the nucleus",
        ]), deflate: true)
        z.add("ppt/slides/slide3.xml", slide("Atomic Number and Mass", [
            "Atomic number: the number of protons in the nucleus of an atom",
            "Mass number is the total count of protons and neutrons in the nucleus",
            "Isotopes are atoms of one element with different numbers of neutrons",
        ]))
        z.add("ppt/slides/slide4.xml", slide("The Periodic Table", [
            "Elements are arranged by increasing atomic number",
            "Columns are called groups and share chemical properties",
            "Rows are called periods",
        ]), deflate: true)
        z.add("ppt/slides/_rels/slide2.xml.rels", "<Relationships><Relationship Id=\"rId2\" Target=\"../notesSlides/notesSlide1.xml\"/></Relationships>")
        z.add("ppt/notesSlides/notesSlide1.xml", "<p:notes xmlns:a=\"a\" xmlns:p=\"p\"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type=\"body\"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Protons and neutrons have almost the same mass, electrons are far lighter</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>", deflate: true)
        return z.finish()
    }

    static let typedPages: [(String, [String])] = [
        ("Lecture 4: Chemical Bonds", [
            "CHEM 110 General Chemistry, week 4.",
            "Covalent bond: a bond formed when two atoms share a pair of electrons.",
            "Ionic bond: a bond formed when one atom gives electrons to another atom.",
            "Electronegativity is how strongly an atom pulls shared electrons toward itself.",
        ]),
        ("Polar Molecules", [
            "Polar molecule: a molecule with an uneven distribution of charge.",
            "Water is polar because oxygen pulls electrons more strongly than hydrogen.",
            "Hydrogen bond: a weak attraction between a hydrogen atom and a nearby electronegative atom.",
        ]),
    ]

    static func drawPage(_ ctx: UIGraphicsPDFRendererContext, title: String, lines: [String]) {
        let t: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 26), .foregroundColor: UIColor.black]
        (title as NSString).draw(at: CGPoint(x: 56, y: 60), withAttributes: t)
        let para = NSMutableParagraphStyle(); para.paragraphSpacing = 14; para.lineSpacing = 4
        let b: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 16), .foregroundColor: UIColor.black, .paragraphStyle: para]
        (lines.joined(separator: "\n") as NSString).draw(in: CGRect(x: 56, y: 120, width: 500, height: 640), withAttributes: b)
    }

    static func typedPDF() -> Data {
        let r = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792), format: {
            let f = UIGraphicsPDFRendererFormat(); f.documentInfo = [kCGPDFContextTitle as String: "CHEM 110: Chemical Bonds"]; return f
        }())
        return r.pdfData { ctx in
            for (title, lines) in typedPages { ctx.beginPage(); drawPage(ctx, title: title, lines: lines) }
        }
    }

    /// A PDF whose page is only an image (like a phone scan), so PDFKit finds no text and Vision must OCR it.
    static func scannedPDF() -> Data {
        let size = CGSize(width: 1224, height: 1584)
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1
        let img = UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
            UIColor(white: 0.96, alpha: 1).setFill(); ctx.fill(CGRect(origin: .zero, size: size))
            ctx.cgContext.rotate(by: 0.008)
            let t: [NSAttributedString.Key: Any] = [.font: UIFont(name: "TimesNewRomanPS-BoldMT", size: 48) ?? UIFont.boldSystemFont(ofSize: 48), .foregroundColor: UIColor(white: 0.1, alpha: 1)]
            ("Week 5 Reading: Reactions" as NSString).draw(at: CGPoint(x: 110, y: 120), withAttributes: t)
            let para = NSMutableParagraphStyle(); para.paragraphSpacing = 26; para.lineSpacing = 6
            let b: [NSAttributedString.Key: Any] = [.font: UIFont(name: "TimesNewRomanPSMT", size: 34) ?? UIFont.systemFont(ofSize: 34), .foregroundColor: UIColor(white: 0.12, alpha: 1), .paragraphStyle: para]
            let text = [
                "CHEM 110 assigned reading.",
                "Reactant: a substance that is used up in a chemical reaction.",
                "Product: a substance that is made by a chemical reaction.",
                "Catalyst: a substance that speeds up a reaction without being used up.",
                "A balanced equation has the same number of each kind of atom on both sides.",
            ].joined(separator: "\n")
            (text as NSString).draw(in: CGRect(x: 110, y: 230, width: 1000, height: 1200), withAttributes: b)
        }
        let r = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792))
        return r.pdfData { ctx in ctx.beginPage(); img.draw(in: CGRect(x: 0, y: 0, width: 612, height: 792)) }
    }

    /// Handwriting-style marker text on a slightly uneven whiteboard, photographed a little crooked.
    static func whiteboard() -> UIImage {
        let size = CGSize(width: 2016, height: 1512)
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1
        return UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
            let cg = ctx.cgContext
            UIColor(red: 0.90, green: 0.91, blue: 0.90, alpha: 1).setFill(); cg.fill(CGRect(origin: .zero, size: size))
            UIColor(red: 0.97, green: 0.97, blue: 0.96, alpha: 1).setFill(); cg.fill(CGRect(x: 60, y: 50, width: 1900, height: 1400))
            // Faint ghosting from earlier erasing.
            UIColor(white: 0.86, alpha: 1).setStroke(); cg.setLineWidth(18)
            cg.move(to: CGPoint(x: 1300, y: 300)); cg.addLine(to: CGPoint(x: 1800, y: 380)); cg.strokePath()
            cg.translateBy(x: 1008, y: 756); cg.rotate(by: -0.025); cg.translateBy(x: -1008, y: -756)
            let hand = UIFont(name: "Noteworthy-Bold", size: 78) ?? UIFont(name: "BradleyHandITCTT-Bold", size: 78) ?? UIFont.systemFont(ofSize: 78)
            let blue = UIColor(red: 0.10, green: 0.22, blue: 0.62, alpha: 1)
            let black = UIColor(white: 0.12, alpha: 1)
            let title: [NSAttributedString.Key: Any] = [.font: hand.withSize(96), .foregroundColor: blue]
            ("Acids and Bases" as NSString).draw(at: CGPoint(x: 170, y: 120), withAttributes: title)
            let lines = [
                "Acid: a substance that gives off hydrogen ions",
                "Base: a substance that takes up hydrogen ions",
                "pH scale goes from 0 to 14",
                "Neutral water has a pH of 7",
            ]
            for (i, l) in lines.enumerated() {
                let a: [NSAttributedString.Key: Any] = [.font: hand, .foregroundColor: i % 2 == 0 ? black : blue]
                (l as NSString).draw(at: CGPoint(x: 170 + CGFloat(i % 2) * 18, y: 330 + CGFloat(i) * 200), withAttributes: a)
            }
        }
    }

    @MainActor static func seedFiles(store: Store, importer: Importer) async {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("seed-files", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let files: [(String, Data)] = [
            ("Lecture 3 - Atoms.pptx", pptx()),
            ("Lecture 4 - Chemical Bonds.pdf", typedPDF()),
            ("Week 5 Reading (scan).pdf", scannedPDF()),
            ("Whiteboard.jpg", whiteboard().jpegData(compressionQuality: 0.85)!),
        ]
        var urls: [URL] = []
        for (n, d) in files { let u = dir.appendingPathComponent(n); try? d.write(to: u); urls.append(u) }
        importer.store = store
        await importer.importFiles(urls)
        print("SEED_FILES \(importer.message ?? "")")
        for p in store.library.inbox {
            print("SEED_FILES page kind=\(p.kind) src=\(p.sourceName ?? "-")#\(p.sourceIndex ?? 0) heading=\(p.heading ?? "-") header=\(p.header ?? "-")")
            print("SEED_FILES text<<\(p.text.replacingOccurrences(of: "\n", with: " | "))>>")
        }
        for g in Grouper.group(store.library.inbox) { print("SEED_FILES group \(g.title) [\(g.type)] pages=\(g.pageIds.count)") }
        store.toast = importer.message
        if args.contains("-showImport") {
            let m = importer.message
            store.showImport = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { importer.message = m; store.toast = nil }
        } else { store.path = [.sort] }
    }

    static var args: [String] { ProcessInfo.processInfo.arguments }
}
#endif

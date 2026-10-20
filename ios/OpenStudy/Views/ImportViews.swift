import PhotosUI
import VisionKit
import SwiftUI
import UniformTypeIdentifiers

struct ImportSheet: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var importer: Importer
    @Environment(\.dismiss) var dismiss
    @State private var picked: [PhotosPickerItem] = []
    @State private var pasting = false
    @State private var files = false
    @State private var scanning = false
    @State private var camera = false
    @State private var appleNotes = false

    static let fileTypes: [UTType] = [.pdf, .plainText, .text, .html, .image, .json,
                                      UTType(filenameExtension: "md") ?? .plainText,
                                      UTType(filenameExtension: "pptx") ?? .data,
                                      UTType(filenameExtension: "docx") ?? .data]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Add material").font(Typo.title).foregroundStyle(Palette.ink)
                Spacer()
                IconButton(systemName: "xmark", label: "Close") { dismiss() }
            }
            if importer.running {
                VStack(alignment: .leading, spacing: 12) {
                    Text(importer.stage).font(Typo.headline).foregroundStyle(Palette.ink).lineLimit(2)
                    ProgressBar(value: importer.progress)
                    Text(importer.sweeping ? importer.sweepText : "\(importer.done) of \(importer.total) done, \(importer.imported) pages added")
                        .font(Typo.small).foregroundStyle(Palette.muted)
                        .monospacedDigit()
                    Button("Stop") { importer.cancel() }.buttonStyle(.chunky(.secondary))
                }
                .padding(.top, 6)
                Spacer()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Drop anything: screenshots, photos of notes or a whiteboard, PDFs, slides, docs.")
                            .font(Typo.rounded(15, .medium)).foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        if let m = importer.message {
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.green)
                                Text(m).font(Typo.bodyBold).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 14).fill(Palette.greenSoft))
                        }
                        Button { files = true } label: { row("Import files", "doc.badge.plus", "PDF, PowerPoint (.pptx), Word (.docx), text, images") }
                            .buttonStyle(TileStyle())
                        PhotosPicker(selection: $picked, maxSelectionCount: nil, selectionBehavior: .ordered, matching: .images, photoLibrary: .shared()) {
                            row("Choose photos", "photo.on.rectangle", "Screenshots, notes, slides, the whiteboard")
                        }
                        .buttonStyle(TileStyle())
                        Button { scanning = true } label: { row("Scan notes or a whiteboard", "doc.viewfinder", VNDocumentCameraViewController.isSupported ? "Straightens the page for you" : "Needs a device camera") }
                            .buttonStyle(TileStyle(state: VNDocumentCameraViewController.isSupported ? .normal : .disabled))
                            .disabled(!VNDocumentCameraViewController.isSupported)
                        if UIImagePickerController.isSourceTypeAvailable(.camera) {
                            Button { camera = true } label: { row("Take a photo", "camera", "One page or board at a time") }
                                .buttonStyle(TileStyle())
                        }
                        Button { Task { await importer.findNotesInPhotos() } } label: {
                            row("Find notes in Photos", "photo.stack", "Checks every photo for notes, book pages and slides. Next time, only new ones.")
                        }
                        .buttonStyle(TileStyle())
                        Button { appleNotes = true } label: {
                            row("Bring in Apple Notes", "note.text", "All your notes at once, with a Shortcut or from your Mac")
                        }
                        .buttonStyle(TileStyle())
                        Button { pasting = true } label: { row("Paste from Notes", "doc.on.clipboard", "Apple Books excerpts keep their book title") }
                            .buttonStyle(TileStyle())
                        Text("Keynote or Google Slides? Export to .pptx or .pdf first.")
                            .font(Typo.rounded(13, .medium)).foregroundStyle(Palette.muted)
                            .padding(.top, 2)
                    }
                }
                if store.inboxCount > 0 {
                    Button("Sort \(store.inboxCount) new \(store.inboxCount == 1 ? "page" : "pages")") {
                        dismiss()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { if store.path.last != .sort { store.path.append(.sort) } }
                    }
                    .buttonStyle(.chunky)
                }
            }
        }
        .padding(20)
        .presentationDetents([.large])
        .presentationBackground(Palette.paper)
        .interactiveDismissDisabled(importer.running)
        .onAppear { importer.message = nil }
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            Task {
                var loaded: [(data: Data, assetId: String?)] = []
                for item in items {
                    if let d = try? await item.loadTransferable(type: Data.self) { loaded.append((d, item.itemIdentifier)) }
                }
                picked = []
                await importer.importPicked(loaded)
            }
        }
        .sheet(isPresented: $pasting) { PasteNotesSheet() }
        .sheet(isPresented: $appleNotes) { AppleNotesSheet(onOpenFile: { appleNotes = false; DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { files = true } }) }
        .fullScreenCover(isPresented: $scanning) {
            DocumentScanner { images in
                scanning = false
                if !images.isEmpty { Task { await importer.importScans(images) } }
            }
            .ignoresSafeArea()
        }
        .fullScreenCover(isPresented: $camera) {
            CameraPicker { image in
                camera = false
                if let image { Task { await importer.importImages([ImageInput(image: image, date: Date())]) } }
            }
            .ignoresSafeArea()
        }
        .fileImporter(isPresented: $files, allowedContentTypes: Self.fileTypes, allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await importer.importFiles(urls) } }
        }
    }

    func row(_ title: String, _ icon: String, _ detail: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon).font(.system(size: 20, weight: .semibold)).frame(width: 28).foregroundStyle(Palette.blue)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Typo.bodyBold).foregroundStyle(Palette.ink)
                Text(detail).font(Typo.rounded(14, .medium)).foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }
}

/// VisionKit document camera (perspective corrected scans).
struct DocumentScanner: UIViewControllerRepresentable {
    var onFinish: ([UIImage]) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onFinish) }
    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let vc = VNDocumentCameraViewController()
        vc.delegate = context.coordinator
        return vc
    }
    func updateUIViewController(_ vc: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onFinish: ([UIImage]) -> Void
        init(_ f: @escaping ([UIImage]) -> Void) { onFinish = f }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            onFinish((0..<scan.pageCount).map { scan.imageOfPage(at: $0) })
        }
        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { onFinish([]) }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { onFinish([]) }
    }
}

/// Camera capture of any photo.
struct CameraPicker: UIViewControllerRepresentable {
    var onFinish: (UIImage?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onFinish) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = .camera
        p.delegate = context.coordinator
        return p
    }
    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onFinish: (UIImage?) -> Void
        init(_ f: @escaping (UIImage?) -> Void) { onFinish = f }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onFinish(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onFinish(nil) }
    }
}

/// iOS gives apps no access to the Notes app, so notes arrive through a Shortcut or a Mac export (spec 9.2).
struct AppleNotesSheet: View {
    @Environment(\.dismiss) var dismiss
    var onOpenFile: () -> Void

    static let steps = [
        "Open Shortcuts and make a new shortcut.",
        "Add Find Notes. Leave it on All Notes.",
        "Add Repeat with Each.",
        "Inside the repeat, add a Text action with these lines: === OpenStudy note ===, then Title: and the Repeat Item's Name, then Folder: and its Folder, then its Body.",
        "After End Repeat, add Combine Text and pick New Lines.",
        "Add Copy to Clipboard.",
        "Add Open URLs with openstudy://import-notes",
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Bring in Apple Notes").font(Typo.title).foregroundStyle(Palette.ink)
                Spacer()
                IconButton(systemName: "xmark", label: "Close") { dismiss() }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Apple does not let apps read Notes directly. A Shortcut can copy every note for you, and OpenStudy picks them up from there. You only build it once.")
                        .font(Typo.rounded(15, .medium)).foregroundStyle(Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("On this iPhone").font(Typo.headline).foregroundStyle(Palette.ink)
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(Self.steps.enumerated()), id: \.offset) { _, step in
                            HStack(alignment: .top, spacing: 10) {
                                Circle().fill(Palette.blue).frame(width: 7, height: 7).padding(.top, 8)
                                Text(step).font(Typo.body).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    Button {
                        UIPasteboard.general.string = AppleNotes.bridgeMarker
                    } label: { Label("Copy the first line", systemImage: "doc.on.doc") }
                        .buttonStyle(.chunky(.secondary, height: 48))
                    Text("Run the shortcut whenever you want. Notes you already added are skipped.")
                        .font(Typo.small).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
                    Text("On a Mac").font(Typo.headline).foregroundStyle(Palette.ink).padding(.top, 6)
                    Text("In the OpenStudy folder, run node web/scripts/export-notes.mjs. It saves apple-notes.json. Put it in iCloud Drive, then open it here.")
                        .font(Typo.body).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
                    Button("Open apple-notes.json", action: onOpenFile).buttonStyle(.chunky)
                }
            }
        }
        .padding(20)
        .presentationBackground(Palette.paper)
    }
}

struct PasteNotesSheet: View {
    @EnvironmentObject var importer: Importer
    @Environment(\.dismiss) var dismiss
    @State private var text = ""

    var preview: [ParsedExcerpt] {
        // Text from the OpenStudy Shortcut: one entry per note.
        if AppleNotes.hasBridgeMarker(text) { return AppleNotes.parseBridgeText(text).map { ParsedExcerpt(text: $0.text ?? "", title: $0.title, author: nil, fromFooter: false) } }
        return NotesParser.parse(text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Paste from Notes").font(Typo.title).foregroundStyle(Palette.ink)
                Spacer()
                IconButton(systemName: "xmark", label: "Close") { dismiss() }
            }
            Text("Copy excerpts in Notes, then paste them here. Lines that end with \u{201C}Excerpt From\u{201D} keep their book and author.")
                .font(Typo.rounded(15, .medium)).foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                if let s = UIPasteboard.general.string, !s.isEmpty {
                    text = text.isEmpty ? s : text + "\n\n" + s
                }
            } label: {
                Label("Paste from clipboard", systemImage: "doc.on.clipboard")
            }
            .buttonStyle(.chunky(.secondary, height: 48))
            TextEditor(text: $text)
                .font(Typo.serif(17))
                .scrollContentBackground(.hidden)
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 14).fill(Palette.shelf))
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text("Or type and paste here").font(Typo.serif(17)).foregroundStyle(Palette.muted).padding(16).allowsHitTesting(false)
                    }
                }
            let p = preview
            if !p.isEmpty {
                let books = Set(p.compactMap(\.title)).count
                Text("\(p.count) \(p.count == 1 ? "page" : "pages")\(books > 0 ? " from \(books) \(books == 1 ? "book" : "books")" : "")")
                    .font(Typo.small).foregroundStyle(Palette.muted)
            }
            Button("Add \(p.count) \(p.count == 1 ? "page" : "pages")") {
                _ = importer.importText(text)
                dismiss()
            }
            .buttonStyle(.chunky)
            .disabled(p.isEmpty)
        }
        .padding(20)
        .presentationBackground(Palette.paper)
    }
}

import SwiftUI
import UniformTypeIdentifiers

struct WelcomeView: View {
    @EnvironmentObject var store: Store
    var onStart: () -> Void
    @State private var importing = false
    @State private var failed = false

    var body: some View {
        let sample = demoLibrary
        ZStack(alignment: .bottom) {
            // The real lesson path, rendered from the sample library, lightly dimmed behind the copy.
            GeometryReader { geo in
                if let project = sample.projects.first {
                    VStack(spacing: 0) {
                        HStack(spacing: 10) {
                            Text(project.title).font(Typo.headline).foregroundStyle(Palette.ink).lineLimit(1)
                        }
                        .padding(.top, 70)
                        LessonPath(library: sample, project: project, interactive: false)
                    }
                    .frame(width: geo.size.width)
                    .opacity(0.5)
                    .blur(radius: 1.2)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
            }
            .ignoresSafeArea()

            VStack(alignment: .leading, spacing: 14) {
                Text("OpenStudy")
                    .font(Typo.rounded(15, .heavy))
                    .foregroundStyle(Palette.blue)
                Text("Anything you want to learn, turned into lessons.")
                    .font(Typo.display)
                    .tracking(-0.6)
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Drop in book screenshots, class slides, PDFs, or a photo of the whiteboard. OpenStudy sorts it, builds the lessons, and plans your study days until it sticks.")
                    .font(Typo.body)
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(spacing: 10) {
                    Button("Get started", action: onStart).buttonStyle(.chunky)
                    Button("I have a library file") { importing = true }.buttonStyle(.chunky(.secondary))
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 24)
            .padding(.top, 26)
            .padding(.bottom, 12)
            .background(
                UnevenRoundedRectangle(topLeadingRadius: 28, topTrailingRadius: 28)
                    .fill(Palette.paper)
                    .overlay(UnevenRoundedRectangle(topLeadingRadius: 28, topTrailingRadius: 28).stroke(Palette.line, lineWidth: 2))
                    .ignoresSafeArea(edges: .bottom)
            )
        }
        .background(Palette.shelf.ignoresSafeArea())
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            if case .success(let url) = result, store.importLibrary(from: url) {
                store.library.profile.onboarded = true
            } else { failed = true }
        }
        .alert("That file could not be read", isPresented: $failed) { Button("OK", role: .cancel) {} } message: {
            Text("Pick a library file exported from OpenStudy on the web or on iPhone.")
        }
    }

    /// Sample library with a little progress so the path shows rings, the Start tag and locked nodes.
    var demoLibrary: Library {
        var lib = Library()
        lib.addSample(store.sample)
        if let i = lib.lessons.firstIndex(where: { $0.id == "lc1" }) { lib.lessons[i].level = 3 }
        if let i = lib.lessons.firstIndex(where: { $0.id == "lcq" }) { lib.lessons[i].level = 1 }
        return lib
    }
}

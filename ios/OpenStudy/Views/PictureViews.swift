import SwiftUI

// Source images in lessons (spec 11.1) and the picture exercise (spec 11.2).

/// Small "From your page" thumbnail for a card's source page. Renders nothing without an image.
struct SourceThumb: View {
    @EnvironmentObject var store: Store
    let cardId: String
    @State private var viewing: ViewedImage?

    var body: some View {
        if let card = store.library.cards.first(where: { $0.id == cardId }), let pid = card.pageId,
           let page = store.library.pages.first(where: { $0.id == pid }), let img = store.image(for: page) {
            Button { viewing = ViewedImage(image: img) } label: {
                HStack(spacing: 10) {
                    Image(uiImage: img).resizable().scaledToFill()
                        .frame(width: 54, height: 72).clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
                    Text(page.pageNumber.map { "From your page p. \($0)" } ?? "From your page")
                        .font(Typo.rounded(14, .bold)).foregroundStyle(Palette.muted)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open your page")
            .fullScreenCover(item: $viewing) { ImageViewer(image: $0.image) }
        }
    }
}

struct ViewedImage: Identifiable {
    let id = UUID()
    let image: UIImage
}

/// Full screen image with pinch to zoom; tap the close button or swipe down to dismiss.
struct ImageViewer: View {
    @Environment(\.dismiss) var dismiss
    let image: UIImage
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            Image(uiImage: image).resizable().scaledToFit()
                .scaleEffect(scale)
                .offset(offset)
                .gesture(MagnificationGesture()
                    .onChanged { scale = max(1, min(5, lastScale * $0)) }
                    .onEnded { _ in lastScale = scale; if scale == 1 { offset = .zero; lastOffset = .zero } })
                .simultaneousGesture(DragGesture()
                    .onChanged { v in
                        if scale > 1 { offset = CGSize(width: lastOffset.width + v.translation.width, height: lastOffset.height + v.translation.height) }
                    }
                    .onEnded { v in
                        if scale > 1 { lastOffset = offset } else if v.translation.height > 120 { dismiss() }
                    })
                .onTapGesture(count: 2) { withAnimation(Motion.quick) { scale = scale > 1 ? 1 : 2.5; lastScale = scale; offset = .zero; lastOffset = .zero } }
                .accessibilityLabel("Your page")
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 44, height: 44).background(Circle().fill(.black.opacity(0.5)))
            }
            .padding(16)
            .accessibilityLabel("Close")
        }
    }
}

/// Picture exercise: the image large, a recall prompt, "Show me", then self grade.
struct PictureExerciseView: View {
    @EnvironmentObject var store: Store
    let ex: Exercise
    var onRate: (Grade) -> Void
    @State private var revealed = false
    @State private var viewing: ViewedImage?

    var body: some View {
        let page = ex.pageId.flatMap { pid in store.library.pages.first { $0.id == pid } }
        let img = page.flatMap { store.image(for: $0) }
        VStack(alignment: .leading, spacing: 18) {
            if let img {
                Button { viewing = ViewedImage(image: img) } label: {
                    Image(uiImage: img).resizable().scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: 340)
                        .background(Palette.shelf)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Your page. Double tap to open full screen.")
            }
            Text(ex.body).font(Typo.rounded(20, .bold)).foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
            if revealed {
                VStack(alignment: .leading, spacing: 8) {
                    Text("On this page").font(Typo.small).foregroundStyle(Palette.muted)
                    Text(ex.answer).font(Typo.serif(18)).foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.blueSoft))
                .transition(.opacity)
                Text("How much did you remember?").font(Typo.small).foregroundStyle(Palette.muted)
                HStack(spacing: 8) {
                    Button("Got it") { onRate(.good) }.buttonStyle(.chunky(.green, height: 48))
                    Button("Partly") { onRate(.hard) }.buttonStyle(.chunky(.secondary, height: 48))
                    Button("Missed it") { onRate(.again) }.buttonStyle(.chunky(.red, height: 48))
                }
            } else {
                Button("Show me") { withAnimation(Motion.quick) { revealed = true } }.buttonStyle(.chunky(.secondary))
            }
        }
        .fullScreenCover(item: $viewing) { ImageViewer(image: $0.image) }
    }
}

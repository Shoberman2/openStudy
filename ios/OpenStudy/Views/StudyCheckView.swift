import SwiftUI

/// The study check sheet (spec 14.3): a checklist of common study biases, screened from your own
/// study history. Free shows the checklist; Plus shows the numbers, what to do, and an export.
struct StudyCheckView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss

    var body: some View {
        let items = StudyCheck.run(store.library)
        let full = store.plusActive
        VStack(spacing: 0) {
            SheetHeader(title: "Study Check", onClose: { dismiss() })
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack(alignment: .center, spacing: 14) {
                        OwlView(mood: .thinking, size: 56)
                        Text(StudyCheck.flagged(items) == 0 ? "Your habits look good. Here's what I checked." : "A few habits are worth a look.")
                            .font(Typo.body).foregroundStyle(Palette.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(items) { item in row(item, full: full) }
                    }
                    if full {
                        ShareLink(item: StudyCheck.report(items), subject: Text("OpenStudy study check")) {
                            Text("Export report")
                        }
                        .buttonStyle(.ghostPill)
                    } else {
                        Button("See the full report") { store.openPaywall(from: "report") }.buttonStyle(.pill)
                    }
                    Text("Based on your own study history. Not medical or research advice.")
                        .font(Typo.small).foregroundStyle(Palette.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)
                .padding(.bottom, 40)
            }
        }
        .background(Palette.bg.ignoresSafeArea())
    }

    func row(_ item: StudyCheck.Item, full: Bool) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon(item.status))
                .font(.system(size: 20, weight: .regular))
                .foregroundStyle(color(item.status))
                .frame(width: 24)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title).font(Typo.bodyBold).foregroundStyle(Palette.ink)
                Text(item.summary).font(Typo.small).foregroundStyle(Palette.ink2).fixedSize(horizontal: false, vertical: true)
                if full {
                    Text(item.detail).font(Typo.small).foregroundStyle(Palette.ink3).fixedSize(horizontal: false, vertical: true).padding(.top, 4)
                    Text(item.tip).font(Typo.small).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.surfaceDim))
        .accessibilityElement(children: .combine)
    }

    func icon(_ s: StudyCheck.Status) -> String {
        switch s { case .ok: "checkmark.circle"; case .flag: "exclamationmark.circle"; case .unknown: "circle.dashed" }
    }
    func color(_ s: StudyCheck.Status) -> Color {
        switch s { case .ok: Palette.ok; case .flag: Palette.warn; case .unknown: Palette.ink3 }
    }
}

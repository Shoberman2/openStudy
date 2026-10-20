import SwiftUI

/// "Ask about <Title>" on a project, "Ask my notes" on Home (spec 10.7).
struct AskBox: View {
    @EnvironmentObject var store: Store
    let projectId: String?
    let placeholder: String
    @State private var question = ""
    @State private var asking = false
    @State private var outcome: Store.AskOutcome?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 16, weight: .bold)).foregroundStyle(Palette.muted)
                TextField(placeholder, text: $question)
                    .font(Typo.rounded(16, .semibold)).foregroundStyle(Palette.ink)
                    .submitLabel(.search)
                    .focused($focused)
                    .onSubmit { Task { await run() } }
                if asking {
                    ProgressView().controlSize(.small)
                } else if !question.isEmpty {
                    Button { question = ""; outcome = nil } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundStyle(Palette.muted).frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Clear question")
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            .frame(minHeight: 48)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(focused ? Palette.blue : Palette.line, lineWidth: 2))
            if let outcome { result(outcome) }
        }
    }

    @ViewBuilder func result(_ o: Store.AskOutcome) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            switch o.kind {
            case .nothing:
                Text("Your notes don't mention this yet.").font(Typo.body).foregroundStyle(Palette.muted)
            case .answer:
                Text(o.answer).font(Typo.body).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
            case .local:
                Text("From your notes").font(Typo.small).foregroundStyle(Palette.muted)
            case .fallback:
                Text("Your notes don't answer this directly. Closest passages:").font(Typo.small).foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(o.quotes, id: \.self) { q in
                VStack(alignment: .leading, spacing: 4) {
                    Text(q.text).font(Typo.serif(16)).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
                    Text(store.sourceLabel(q.pageId)).font(Typo.tiny).foregroundStyle(Palette.muted)
                }
                .padding(.leading, 12)
                .overlay(alignment: .leading) { Rectangle().fill(Palette.line).frame(width: 3) }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.shelf))
    }

    func run() async {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !asking else { return }
        asking = true
        outcome = await store.ask(q, projectId: projectId)
        asking = false
    }
}

/// "Connections" on Home: two projects that cover the same ideas, with "Practice both" (spec 10.8).
struct ConnectionsSection: View {
    @EnvironmentObject var store: Store

    var body: some View {
        let lib = store.library
        let conns = lib.connections()
        if !conns.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Connections").font(Typo.headline).foregroundStyle(Palette.ink)
                ForEach(conns) { c in
                    let titles = c.projects.map { lib.project($0)?.title ?? "" }
                    let lessons = c.lessons.compactMap { id in lib.lessons.first { $0.id == id }?.title }
                    VStack(alignment: .leading, spacing: 8) {
                        Text(Connections.sentence(titles[0], titles[1], terms: c.terms))
                            .font(Typo.bodyBold).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
                        Text(lessons.joined(separator: "  \u{00B7}  ")).font(Typo.small).foregroundStyle(Palette.muted)
                        Button("Practice both") { store.startConnection(c) }
                            .buttonStyle(.chunky(.secondary, height: 44))
                    }
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
                }
            }
        }
    }
}

/// "12 words need a definition" on a Words project (spec 10.2).
struct WordsToDefine: View {
    @EnvironmentObject var store: Store
    let projectId: String
    @State private var drafts: [String: String] = [:]
    @State private var open = false

    var body: some View {
        let missing = store.library.undefinedWords(of: projectId)
        if !missing.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Button { withAnimation(Motion.quick) { open.toggle() } } label: {
                    HStack {
                        Text("\(missing.count) \(missing.count == 1 ? "word needs" : "words need") a definition")
                            .font(Typo.bodyBold).foregroundStyle(Palette.ink)
                        Spacer()
                        Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 14, weight: .bold)).foregroundStyle(Palette.muted)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if open {
                    ForEach(missing, id: \.term) { w in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(w.term).font(Typo.bodyBold).foregroundStyle(Palette.ink)
                            HStack(spacing: 8) {
                                TextField("What it means", text: Binding(get: { drafts[w.term] ?? "" }, set: { drafts[w.term] = $0 }))
                                    .font(Typo.rounded(15, .medium))
                                    .submitLabel(.done)
                                    .onSubmit { save(w) }
                                    .padding(.horizontal, 10).frame(minHeight: 40)
                                    .background(RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.line, lineWidth: 2))
                                Button("Save") { save(w) }
                                    .buttonStyle(.chunky(.primary, height: 40, fullWidth: false))
                                    .disabled((drafts[w.term] ?? "").trimmingCharacters(in: .whitespaces).isEmpty)
                            }
                        }
                    }
                }
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.shelf))
        }
    }

    func save(_ w: (pageId: String, term: String)) {
        guard let d = drafts[w.term], !d.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        store.defineWord(pageId: w.pageId, term: w.term, definition: d)
        drafts[w.term] = nil
        Haptics.tap()
    }
}

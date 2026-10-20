import SwiftUI

struct SortView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @State private var groups: [SuggestedGroup] = []
    @State private var creating: SuggestedGroup?
    @State private var smartBusy = false
    @State private var viewing: Page?
    @State private var organizing: (index: Int, total: Int, title: String)?

    var body: some View {
        let inbox = store.library.inbox
        VStack(spacing: 0) {
            HStack {
                IconButton(systemName: "chevron.left", label: "Back") { dismiss() }
                Spacer()
                if store.smartClient != nil {
                    Button {
                        Task { await smartSort() }
                    } label: {
                        HStack(spacing: 6) {
                            if smartBusy { ProgressView().controlSize(.small) } else { Image(systemName: "sparkle") }
                            Text("Smart organize")
                        }
                        .font(Typo.rounded(15, .bold))
                    }
                    .disabled(smartBusy || !store.smartOn)
                    .padding(.trailing, 12)
                }
            }
            .padding(.horizontal, 8)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Sort new pages").font(Typo.title).foregroundStyle(Palette.ink)
                        if !inbox.isEmpty {
                            Text(Grouper.detectionSummary(groups)).font(Typo.bodyBold).foregroundStyle(Palette.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Text(inbox.isEmpty ? "Everything is sorted." : "\(inbox.count) \(inbox.count == 1 ? "page" : "pages") in \(groups.count) suggested \(groups.count == 1 ? "project" : "projects"). Fix titles and types, then create each one.")
                            .font(Typo.body).foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    let bulk = Store.bulkGroups(groups)
                    if let o = organizing {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Building \(o.index) of \(o.total): \(o.title)").font(Typo.headline).foregroundStyle(Palette.ink).lineLimit(2)
                            ProgressBar(value: Double(o.index - 1) / Double(max(1, o.total)))
                        }
                        .padding(16)
                        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Palette.shelf))
                    } else if bulk.count >= 2 {
                        let k = Set(bulk.compactMap { $0.category?.lowercased() }).count
                        VStack(alignment: .leading, spacing: 10) {
                            Button("Create all \(bulk.count) projects") { if store.plusAllowed(from: "create_all") { Task { await createAll() } } }
                                .buttonStyle(.chunky)
                            Text("Books, classes and topics, sorted into \(k) \(k == 1 ? "category" : "categories").")
                                .font(Typo.small).foregroundStyle(Palette.muted)
                        }
                    }
                    ForEach($groups) { $group in
                        GroupCard(group: $group, allGroups: groups,
                                  onCreate: { if store.plusAllowed(from: "create_project") { creating = group } },
                                  onMove: { pageId, target in move(pageId, to: target) },
                                  onView: { viewing = $0 })
                    }
                    if inbox.isEmpty {
                        Button("Back to the shelf") { dismiss() }.buttonStyle(.chunky(.secondary))
                    }
                }
                .padding(20)
            }
        }
        .background(Palette.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .disabled(organizing != nil)
        .onAppear {
            sync()
            #if DEBUG
            if DebugLaunch.value("-autocreate") != nil, creating == nil { DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { creating = groups.first } }
            #endif
        }
        .onChange(of: store.library.inbox.map(\.id)) { _, _ in sync() }
        .onChange(of: groups) { _, _ in persist() }
        .sheet(item: $creating) { g in
            CreateProjectFlow(group: g) { projectId in
                creating = nil
                if let projectId {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        var jump = store.library.inbox.isEmpty
                        #if DEBUG
                        if DebugLaunch.value("-autocreate") == "full" { jump = true }
                        #endif
                        if jump { store.path = [.project(projectId)] }
                        else { store.toast = "Book created" }
                    }
                }
            }
        }
        .sheet(item: $viewing) { PageDetail(page: $0) }
    }

    func sync() {
        let inboxIds = Set(store.library.inbox.map(\.id))
        for i in groups.indices { groups[i].pageIds.removeAll { !inboxIds.contains($0) } }
        groups.removeAll { $0.pageIds.isEmpty }
        let known = Set(groups.flatMap(\.pageIds))
        let fresh = store.library.inbox.filter { !known.contains($0.id) }
        guard !fresh.isEmpty else { return }
        for g in Grouper.group(fresh) {
            if let i = groups.firstIndex(where: { $0.title.lowercased() == g.title.lowercased() }) { groups[i].pageIds += g.pageIds }
            else { groups.append(g) }
        }
        // Keep Unsorted last.
        groups.sort { ($0.title == Grouper.unsorted ? 1 : 0) < ($1.title == Grouper.unsorted ? 1 : 0) }
    }

    /// Writes Sort edits (renames, author, moves) onto the pages so they survive a relaunch,
    /// because grouping prefers suggestedTitle (same as the web app).
    func persist() {
        var lib = store.library
        var changed = false
        for g in groups {
            let unsorted = g.title == Grouper.unsorted
            let trimmed = g.title.trimmingCharacters(in: .whitespaces)
            let title = unsorted || trimmed.isEmpty ? nil : trimmed
            let author = unsorted ? nil : g.author
            for id in g.pageIds {
                guard let i = lib.pages.firstIndex(where: { $0.id == id }) else { continue }
                if lib.pages[i].suggestedTitle != title || lib.pages[i].suggestedAuthor != author {
                    lib.pages[i].suggestedTitle = title
                    lib.pages[i].suggestedAuthor = author
                    changed = true
                }
            }
        }
        if changed { store.library = lib }
    }

    func move(_ pageId: String, to target: String?) {
        for i in groups.indices { groups[i].pageIds.removeAll { $0 == pageId } }
        if let target, let i = groups.firstIndex(where: { $0.id == target }) {
            groups[i].pageIds.append(pageId)
        } else if target == nil {
            store.discardPages([pageId])
        } else {
            groups.append(SuggestedGroup(id: target!, title: "New book", pageIds: [pageId]))
        }
        groups.removeAll { $0.pageIds.isEmpty }
    }

    /// Spec 9.6: builds every group but Unsorted and Loose notes, then goes Home.
    func createAll() async {
        let todo = Store.bulkGroups(groups)
        organizing = (1, todo.count, todo.first?.title ?? "")
        await store.organizeAll(groups) { i, title in organizing = (i, todo.count, title) }
        organizing = nil
        store.path = []
        store.toast = "Your shelf is ready"
    }

    func smartSort() async {
        guard let client = store.smartClient else { return }
        smartBusy = true
        defer { smartBusy = false }
        // Word pages never go to the server: they always group offline (spec 10.10).
        let inbox = store.library.inbox
        let wordPages = inbox.filter { !($0.words ?? []).isEmpty }
        let rest = inbox.filter { ($0.words ?? []).isEmpty }
        if rest.isEmpty { withAnimation(Motion.quick) { groups = Grouper.group(wordPages) }; return }
        if let result = await client.sort(rest) { withAnimation(Motion.quick) { groups = (wordPages.isEmpty ? [] : Grouper.group(wordPages)) + result } }
        else { store.toast = "Smart organize is off, using offline sorting" }
    }
}

struct GroupCard: View {
    @EnvironmentObject var store: Store
    @Binding var group: SuggestedGroup
    let allGroups: [SuggestedGroup]
    var onCreate: () -> Void
    var onMove: (String, String?) -> Void
    var onView: (Page) -> Void

    var body: some View {
        let pages = group.pageIds.compactMap { id in store.library.pages.first { $0.id == id } }
        let match = store.matchingProject(title: group.title, author: group.author)
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                TextField("Book title", text: $group.title)
                    .font(Typo.headline).foregroundStyle(Palette.ink)
                    .submitLabel(.done)
                TextField(group.type == "class" ? "Teacher or term (optional)" : "Author (optional)", text: Binding(get: { group.author ?? "" }, set: { group.author = $0.isEmpty ? nil : $0 }))
                    .font(Typo.rounded(15, .medium)).foregroundStyle(Palette.muted)
                    .submitLabel(.done)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12).fill(Palette.shelf))

            CategoryField(category: Binding(get: { group.category ?? "" }, set: { group.category = $0.isEmpty ? nil : $0 }),
                          suggestions: store.categorySuggestions)

            HStack(spacing: 8) {
                ForEach([("book", "Book", "book.closed"), ("class", "Class", "graduationcap"), ("other", "Other", "square.stack")], id: \.0) { t in
                    Button { group.type = t.0 } label: { Label(t.1, systemImage: t.2).font(Typo.rounded(14, .bold)) }
                        .buttonStyle(ChipStyle(state: group.type == t.0 ? .selected : .normal))
                        .accessibilityAddTraits(group.type == t.0 ? .isSelected : [])
                }
            }
            Text(summary(pages)).font(Typo.small).foregroundStyle(Palette.muted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(pages) { p in
                        PageThumb(page: p)
                            .onTapGesture { onView(p) }
                            .contextMenu {
                                ForEach(allGroups.filter { $0.id != group.id }) { g in
                                    Button { onMove(p.id, g.id) } label: { Label("Move to \(g.title)", systemImage: "arrow.right") }
                                }
                                Button { onMove(p.id, IDGen.make()) } label: { Label("Move to a new book", systemImage: "plus") }
                                Button(role: .destructive) { onMove(p.id, nil) } label: { Label("Discard page", systemImage: "trash") }
                            }
                    }
                }
                .padding(.vertical, 2)
            }
            Text("Long press a page to move or discard it.").font(Typo.rounded(13, .medium)).foregroundStyle(Palette.muted)

            if let match {
                Button("Add all to \(match.title)") { store.addPages(group.pageIds, toProject: match.id) }
                    .buttonStyle(.chunky)
                Button("Create a separate project", action: onCreate).buttonStyle(.chunky(.secondary))
            } else {
                Button(group.type == "class" ? "Create class" : group.type == "book" ? "Create book" : "Create project", action: onCreate)
                    .buttonStyle(.chunky)
                    .disabled(group.title.trimmingCharacters(in: .whitespaces).isEmpty || group.title == Grouper.unsorted && pages.isEmpty)
                HStack(spacing: 10) {
                    if !store.library.projects.isEmpty {
                        Menu {
                            ForEach(store.library.projects) { p in
                                Button(p.title) { store.addPages(group.pageIds, toProject: p.id) }
                            }
                        } label: {
                            Text("Merge into a project").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.chunky(.secondary))
                    }
                    if group.title == Grouper.unsorted {
                        Button("Discard all") { store.discardPages(group.pageIds) }.buttonStyle(.chunky(.secondary))
                    }
                }
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Palette.paper))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
    }
}

extension GroupCard {
    func summary(_ pages: [Page]) -> String {
        if !pages.isEmpty, pages.allSatisfy({ !($0.words ?? []).isEmpty }) {
            let n = Set(pages.flatMap { $0.words ?? [] }.map { $0.term.lowercased() }).count
            return "\(n) \(n == 1 ? "word" : "words")"
        }
        let p = "\(pages.count) \(pages.count == 1 ? "page" : "pages")"
        if !pages.isEmpty, pages.allSatisfy({ $0.noteId != nil }) {
            let notes = Set(pages.compactMap(\.noteId)).count
            return notes > 1 ? "\(p) from \(notes) notes" : p
        }
        let files = Set(pages.compactMap(\.sourceName)).count
        return files > 1 ? "\(p) from \(files) files" : p
    }
}

/// Editable category with suggestions from the shelf (spec 9.6, 9.7).
struct CategoryField: View {
    @Binding var category: String
    var suggestions: [String]
    var onCommit: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "tag").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.muted)
            TextField("Category", text: $category)
                .font(Typo.rounded(15, .bold)).foregroundStyle(Palette.ink)
                .submitLabel(.done)
                .onSubmit { onCommit?() }
            Menu {
                ForEach(suggestions, id: \.self) { c in Button(c) { category = c; onCommit?() } }
            } label: {
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 14, weight: .bold)).foregroundStyle(Palette.blue)
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel("Pick a category")
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.line, lineWidth: 2))
    }
}

struct PageThumb: View {
    @EnvironmentObject var store: Store
    let page: Page
    var body: some View {
        Group {
            if let img = store.image(for: page) {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                Text(page.text)
                    .font(Typo.serif(11))
                    .foregroundStyle(Palette.ink)
                    .lineSpacing(1)
                    .padding(9)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(Color(uiColor: .dynamic(0xFBF8F1, 0x1E1D1A)))
            }
        }
        .frame(width: 96, height: 150)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
        .overlay(alignment: .bottomTrailing) {
            if let n = page.pageNumber {
                Text("p. \(n)").font(Typo.rounded(11, .bold)).foregroundStyle(Palette.ink)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Capsule().fill(Palette.paper))
                    .padding(5)
            }
        }
        .accessibilityLabel(String(page.text.prefix(80)))
    }
}

// MARK: - Project creation questions (spec 6.3)

struct CreateProjectFlow: View {
    @EnvironmentObject var store: Store
    let group: SuggestedGroup
    var onDone: (String?) -> Void

    @State private var step = 0
    @State private var focus = "ideas"
    @State private var built: BuildResult?
    @State private var wantQuotes = false
    @State private var picked = Set<String>()
    @State private var building = false

    var title: String { group.title.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Spacer()
                IconButton(systemName: "xmark", label: "Close") { onDone(nil) }
            }
            .padding(.bottom, -10)
            if building {
                Spacer()
                VStack(spacing: 14) {
                    ProgressView().controlSize(.large)
                    Text(group.type == "book" ? "Finding the themes in \(title)" : "Building lessons for \(title)").font(Typo.headline).foregroundStyle(Palette.ink).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                Spacer()
            } else if step == 0 && group.type != "book" {
                Text("Build lessons for \(title)?").font(Typo.title).foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(group.type == "class" ? "Each lecture or file becomes a lesson. Key terms become definition cards, and your plan spaces them out before the exam." : "Sections become lessons, with definition cards for key terms.")
                    .font(Typo.body).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button("Build lessons") { Task { await build() } }.buttonStyle(.chunky)
            } else if step == 0 {
                Text("How do you want to study \(title)?").font(Typo.title).foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Button { focus = "ideas" } label: { option("Big ideas", "Themes and key facts as lessons", "lightbulb") }
                    .buttonStyle(TileStyle(state: focus == "ideas" ? .selected : .normal, minHeight: 70))
                Button { focus = "ideas+quotes" } label: { option("Ideas and exact quotes", "Plus a Quotes lesson for the exact wording", "quote.opening") }
                    .buttonStyle(TileStyle(state: focus == "ideas+quotes" ? .selected : .normal, minHeight: 70))
                Spacer()
                Button("Continue") { Task { await build() } }.buttonStyle(.chunky)
            } else if let built {
                let n = built.quotes.count
                Text("We found \(n) \(n == 1 ? "line" : "lines") that read like quotes. Want a Quotes lesson so you learn the exact wording?")
                    .font(Typo.title).foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    Button("Yes, make it") { wantQuotes = true }
                        .buttonStyle(TileStyle(state: wantQuotes ? .selected : .normal, alignment: .center))
                    Button("No, just the ideas") { wantQuotes = false }
                        .buttonStyle(TileStyle(state: !wantQuotes ? .selected : .normal, alignment: .center))
                }
                if wantQuotes {
                    Text("Untick any line you do not want.").font(Typo.small).foregroundStyle(Palette.muted)
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(built.quotes, id: \.text) { q in
                                Button {
                                    if picked.contains(q.text) { picked.remove(q.text) } else { picked.insert(q.text) }
                                } label: {
                                    HStack(alignment: .top, spacing: 10) {
                                        Image(systemName: picked.contains(q.text) ? "checkmark.square.fill" : "square")
                                            .font(.system(size: 20, weight: .semibold))
                                            .foregroundStyle(picked.contains(q.text) ? Palette.blue : Palette.line)
                                        Text(q.text).font(Typo.serif(16)).foregroundStyle(Palette.ink)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                    }
                                }
                                .buttonStyle(TileStyle(minHeight: 44))
                            }
                        }
                    }
                } else { Spacer() }
                Button("Create book") { create(asked: true) }
                    .buttonStyle(.chunky)
                    .disabled(wantQuotes && picked.isEmpty)
            }
        }
        .padding(20)
        .presentationBackground(Palette.paper)
        .interactiveDismissDisabled(building)
        .onAppear {
            #if DEBUG
            if let mode = DebugLaunch.value("-autocreate") {
                focus = "ideas+quotes"
                Task {
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    await build()
                    if mode == "full", built != nil { create(asked: true) }
                }
            }
            #endif
        }
    }

    func option(_ t: String, _ d: String, _ icon: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon).font(.system(size: 20, weight: .semibold)).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(t).font(Typo.bodyBold)
                Text(d).font(Typo.rounded(14, .medium)).foregroundStyle(Palette.muted)
            }
            Spacer()
        }
    }

    func build() async {
        building = true
        let pages = store.library.pages.filter { group.pageIds.contains($0.id) }
        let result: BuildResult? = await store.buildLessons(title: title, author: group.author, type: group.type, pageIds: group.pageIds)
        built = result
        building = false
        guard let result else { return }
        // The Quotes question is only asked for books (or when verbatim excerpts exist).
        let verbatim = pages.contains { $0.verbatim == true }
        if result.quotes.isEmpty || (group.type != "book" && !verbatim) {
            create(asked: false)
        } else {
            wantQuotes = focus == "ideas+quotes"
            picked = Set(result.quotes.map(\.text))
            withAnimation(Motion.slide) { step = 1 }
        }
    }

    func create(asked: Bool) {
        guard let built else { return }
        let quotes = wantQuotes ? built.quotes.filter { picked.contains($0.text) } : nil
        if built.lessons.isEmpty && (quotes ?? []).isEmpty {
            store.toast = "Not enough text to build lessons yet"
        }
        let p = store.createProject(title: title, author: group.author, pageIds: group.pageIds, build: built,
                                    focus: wantQuotes ? "ideas+quotes" : "ideas", quotes: quotes, asked: asked, type: group.type, category: group.category)
        onDone(p.id)
    }
}

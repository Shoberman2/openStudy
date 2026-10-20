import SwiftUI

struct ProjectView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    let projectId: String
    @State private var tab = 0
    @State private var sheetLesson: String?
    @State private var confirmDelete = false
    @State private var renaming = false
    @State private var newTitle = ""

    var body: some View {
        if let project = store.library.project(projectId) {
            VStack(spacing: 0) {
                header(project)
                if tab == 0 {
                    ScrollView {
                        ProjectGoalBar(project: project)
                            .padding(.horizontal, 20).padding(.top, 16)
                        WordsToDefine(projectId: project.id)
                            .padding(.horizontal, 20).padding(.top, 12)
                        AskBox(projectId: project.id, placeholder: "Ask about \(project.title)")
                            .padding(.horizontal, 20).padding(.top, 12)
                        LessonPath(library: store.library, project: project) { sheetLesson = $0.id }
                            .padding(.bottom, 40)
                    }
                } else {
                    PagesList(project: project)
                }
            }
            .background(Palette.paper.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .sheet(item: Binding(get: { sheetLesson.map(IdentifiedString.init) }, set: { sheetLesson = $0?.id })) { s in
                LessonSheet(lessonId: s.id)
            }
            .confirmationDialog("Delete \(project.title)?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete book and its lessons", role: .destructive) {
                    store.library.deleteProject(project.id)
                    dismiss()
                }
            } message: { Text("Pages, lessons and progress for this book are removed from this iPhone.") }
            .alert("Rename", isPresented: $renaming) {
                TextField("Title", text: $newTitle)
                Button("Save") { store.renameProject(project.id, to: newTitle) }
                Button("Cancel", role: .cancel) {}
            }
            .onAppear {
                #if DEBUG
                if UserDefaults.standard.integer(forKey: "debug.projectTab") == 1 { tab = 1; UserDefaults.standard.removeObject(forKey: "debug.projectTab") }
                #endif
            }
        } else {
            Color.clear.onAppear { dismiss() }
        }
    }

    func header(_ project: Project) -> some View {
        let pages = store.library.pages(of: project.id).count
        let lessons = store.library.lessons(of: project.id)
        let done = lessons.filter { $0.level > 0 }.count
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                IconButton(systemName: "chevron.left", label: "Back") { dismiss() }
                Spacer()
                Menu {
                    Button { store.showImport = true } label: { Label("Add material", systemImage: "plus") }
                    Button { newTitle = project.title; renaming = true } label: { Label("Rename", systemImage: "pencil") }
                    Picker(selection: Binding(get: { project.kind }, set: { v in
                        if let i = store.library.projects.firstIndex(where: { $0.id == project.id }) { store.library.projects[i].type = v }
                    })) {
                        Text("Book").tag("book"); Text("Class").tag("class"); Text("Other").tag("other")
                    } label: { Label("Type", systemImage: "tag") }
                    .pickerStyle(.menu)
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete book", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 19, weight: .bold)).foregroundStyle(Palette.muted)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .accessibilityLabel("More")
            }
            .padding(.horizontal, 8)
            HStack(alignment: .top, spacing: 14) {
                RoundedRectangle(cornerRadius: 4).fill(project.color.fill).frame(width: 10, height: 56)
                VStack(alignment: .leading, spacing: 3) {
                    Text(project.title).font(Typo.title).foregroundStyle(Palette.ink).lineLimit(2).minimumScaleFactor(0.8)
                    Text([project.author, "\(pages) \(pages == 1 ? "page" : "pages")", "\(done) of \(lessons.count) started"].compactMap { $0 }.joined(separator: "  \u{00B7}  "))
                        .font(Typo.small).foregroundStyle(Palette.muted).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
            .padding(.horizontal, 20)
            SegmentedTabs(selection: $tab, titles: ["Path", "Pages"])
                .padding(.horizontal, 20)
                .padding(.bottom, 4)
            Rectangle().fill(Palette.line).frame(height: 2)
        }
    }
}

struct IdentifiedString: Identifiable { let id: String }

struct SegmentedTabs: View {
    @Binding var selection: Int
    let titles: [String]
    var body: some View {
        HStack(spacing: 8) {
            ForEach(titles.indices, id: \.self) { i in
                Button(titles[i]) { withAnimation(Motion.quick) { selection = i } }
                    .buttonStyle(TileStyle(state: selection == i ? .selected : .normal, minHeight: 42, alignment: .center))
                    .accessibilityAddTraits(selection == i ? .isSelected : [])
            }
        }
    }
}

// MARK: - Pages tab

struct PagesList: View {
    @EnvironmentObject var store: Store
    let project: Project
    @State private var quotePage: Page?
    @State private var viewing: Page?

    var body: some View {
        let pages = store.library.pages(of: project.id)
        ScrollView {
            LazyVStack(spacing: 12) {
                if pages.isEmpty {
                    Text("No source pages. Add pages from the menu above.")
                        .font(Typo.body).foregroundStyle(Palette.muted).padding(.top, 40)
                }
                ForEach(pages) { page in
                    PageRow(page: page)
                        .contentShape(Rectangle())
                        .onTapGesture { viewing = page }
                        .overlay(alignment: .topTrailing) {
                            Menu {
                                Button { quotePage = page } label: { Label("Mark as quote", systemImage: "quote.opening") }
                                Menu {
                                    ForEach(store.library.projects.filter { $0.id != project.id }) { p in
                                        Button(p.title) { store.addPages([page.id], toProject: p.id) }
                                    }
                                    Button("Back to the inbox") { store.movePage(page.id, to: nil) }
                                } label: { Label("Move to", systemImage: "arrow.right.square") }
                                Button(role: .destructive) { store.discardPages([page.id]) } label: { Label("Delete page", systemImage: "trash") }
                            } label: {
                                Image(systemName: "ellipsis.circle.fill")
                                    .font(.system(size: 24)).symbolRenderingMode(.hierarchical)
                                    .foregroundStyle(Palette.muted)
                                    .frame(width: 44, height: 44).contentShape(Rectangle())
                            }
                            .accessibilityLabel("Page actions")
                        }
                }
            }
            .padding(20)
        }
        .sheet(item: $quotePage) { MarkQuoteSheet(page: $0) }
        .sheet(item: $viewing) { PageDetail(page: $0) }
    }
}

struct PageRow: View {
    @EnvironmentObject var store: Store
    let page: Page
    var lines = 4
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let img = store.image(for: page) {
                Image(uiImage: img).resizable().scaledToFill()
                    .frame(width: 54, height: 92).clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Palette.line, lineWidth: 1))
            } else {
                Image(systemName: page.kind == "note" ? "note.text" : "doc.text")
                    .font(.system(size: 18, weight: .semibold)).foregroundStyle(Palette.muted)
                    .frame(width: 36, height: 36).background(Circle().fill(Palette.shelf))
            }
            VStack(alignment: .leading, spacing: 6) {
                if let h = page.header ?? page.suggestedTitle {
                    Text(h).font(Typo.tiny).foregroundStyle(Palette.muted).lineLimit(1)
                }
                Text(page.text).font(Typo.serif(16)).foregroundStyle(Palette.ink).lineLimit(lines)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.trailing, 30)
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.paper))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
    }
}

struct PageDetail: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    let page: Page
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(page.header ?? page.suggestedTitle ?? (page.kind == "note" ? "Note" : "Page"))
                        .font(Typo.small).foregroundStyle(Palette.muted)
                    Spacer()
                    IconButton(systemName: "xmark", label: "Close") { dismiss() }
                }
                Text(page.text).font(Typo.serif(19)).foregroundStyle(Palette.ink).lineSpacing(5)
                    .textSelection(.enabled)
                if let img = store.image(for: page) {
                    Image(uiImage: img).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.line, lineWidth: 1))
                }
            }
            .padding(20)
        }
        .presentationBackground(Palette.paper)
    }
}

struct MarkQuoteSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    let page: Page
    @State private var added = Set<String>()

    var body: some View {
        let sentences = page.kind == "note" && TextKit.wordCount(page.text) <= 60 ? [page.text] : TextKit.sentences(page.text).filter { TextKit.wordCount($0) >= 4 }
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Mark as quote").font(Typo.title).foregroundStyle(Palette.ink)
                Spacer()
                IconButton(systemName: "xmark", label: "Close") { dismiss() }
            }
            Text("Tap the lines you want to learn word for word.").font(Typo.body).foregroundStyle(Palette.muted)
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(sentences, id: \.self) { s in
                        Button {
                            guard !added.contains(s) else { return }
                            store.markQuote(s, page: page)
                            added.insert(s)
                            Haptics.tap()
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Text(s).font(Typo.serif(17)).frame(maxWidth: .infinity, alignment: .leading)
                                Image(systemName: added.contains(s) ? "checkmark.circle.fill" : "plus.circle")
                                    .font(.system(size: 22))
                            }
                        }
                        .buttonStyle(TileStyle(state: added.contains(s) ? .selected : .normal))
                    }
                }
            }
            Button("Done") { dismiss() }.buttonStyle(.chunky)
        }
        .padding(20)
        .presentationBackground(Palette.paper)
    }
}

/// Goal date control, practice test button and feasibility for one project (spec 8.6).
struct ProjectGoalBar: View {
    @EnvironmentObject var store: Store
    let project: Project
    @State private var category = ""

    var body: some View {
        let ready = store.readyLessons(project.id)
        let feas = store.plan.feasibility.first { $0.projectId == project.id }
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "calendar").font(.system(size: 18, weight: .bold)).foregroundStyle(Palette.blue)
                    .frame(width: 36, height: 36).background(Circle().fill(Palette.blueSoft))
                VStack(alignment: .leading, spacing: 1) {
                    Text("Goal date").font(Typo.bodyBold).foregroundStyle(Palette.ink).lineLimit(1).fixedSize()
                    Text(project.goalDate == nil ? "Exam or finish-by date" : countdown).font(Typo.rounded(13, .semibold)).foregroundStyle(Palette.muted)
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
                .layoutPriority(1)
                Spacer(minLength: 4)
                if project.goalDate != nil {
                    DatePicker("Goal date", selection: Binding(get: { DayKey.date(project.goalDate!) ?? Date() }, set: { set(DayKey.of($0)) }),
                               in: Calendar.current.startOfDay(for: Date())..., displayedComponents: .date)
                        .labelsHidden()
                    Button { set(nil) } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(Palette.muted)
                            .frame(width: 32, height: 44)
                    }
                    .accessibilityLabel("Clear goal date")
                } else {
                    Button("Add") { set(DayKey.of(Calendar.current.date(byAdding: .day, value: 14, to: Date())!)) }
                        .buttonStyle(.chunky(.secondary, height: 40, fullWidth: false))
                }
            }
            // Spec 9.7: the shelf groups projects by this.
            CategoryField(category: $category, suggestions: store.categorySuggestions) {
                store.setCategory(project.id, to: category)
                category = store.library.project(project.id)?.category ?? category
            }
            .onAppear { category = project.category ?? "" }
            if ready >= 2 {
                Button { store.startTest(projectId: project.id) } label: {
                    Label("Take a practice test", systemImage: "checklist")
                }
                .buttonStyle(.chunky(.secondary))
            }
            if let feas { FeasibilityCard(f: feas) }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.shelf))
    }

    var countdown: String {
        guard let g = project.goalDate, let n = DayKey.days(from: DayKey.of(Date()), to: g) else { return "" }
        if n < 0 { return "Passed" }
        if n == 0 { return "Today" }
        return n == 1 ? "Tomorrow" : "In \(n) days"
    }

    func set(_ v: String?) {
        if let i = store.library.projects.firstIndex(where: { $0.id == project.id }) { store.library.projects[i].goalDate = v }
    }
}

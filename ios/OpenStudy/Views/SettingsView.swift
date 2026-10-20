import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @State private var reminderOn = false
    @State private var reminderTime = Reminders.date(from: nil)
    @State private var server = ""
    @State private var checking = false
    @State private var importing = false
    @State private var importResult: String?
    @State private var confirmReset = false
    @State private var exportURL: URL?
    @State private var ready = false

    var body: some View {
        let lib = store.library
        let week = lib.weekStats()
        VStack(spacing: 0) {
            HStack {
                IconButton(systemName: "chevron.left", label: "Back") { dismiss() }
                Spacer()
            }
            .padding(.horizontal, 8)
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    Text("Settings").font(Typo.title).foregroundStyle(Palette.ink)

                    section("Your week") {
                        HStack(spacing: 6) {
                            ForEach(Array(week.activeDays.enumerated()), id: \.offset) { i, on in
                                VStack(spacing: 6) {
                                    Circle().fill(on ? Palette.yellow : Palette.shelf)
                                        .overlay(Circle().strokeBorder(on ? Palette.yellowLip : Palette.line, lineWidth: 2))
                                        .overlay { if on { Image(systemName: "flame.fill").font(.system(size: 13, weight: .bold)).foregroundStyle(Color(uiColor: UIColor(hex: 0x141414))) } }
                                        .frame(width: 32, height: 32)
                                    Text(dayLetter(6 - i)).font(Typo.tiny).foregroundStyle(Palette.muted)
                                }
                                .frame(maxWidth: .infinity)
                            }
                        }
                        HStack(spacing: 10) {
                            weekStat("\(week.daysActive) of 7", "days active")
                            weekStat("\(week.sessions)", "sessions")
                            weekStat(week.accuracy.map { "\(Int(($0 * 100).rounded()))%" } ?? "None", "accuracy")
                            weekStat("\(week.due)", "cards due")
                        }
                    }

                    section("What you want from your reading") {
                        chips(OnboardingCopy.goals, selected: lib.profile.goals) { toggle(\.goals, $0) }
                    }
                    section("How you like to practice") {
                        chips(OnboardingCopy.practice, selected: lib.profile.practice) { toggle(\.practice, $0) }
                    }
                    section("Daily goal") {
                        HStack(spacing: 8) {
                            ForEach(OnboardingCopy.dailyGoals, id: \.xp) { g in
                                Button { store.library.profile.dailyGoalXP = g.xp } label: {
                                    VStack(spacing: 2) {
                                        Text(g.title).font(Typo.rounded(14, .bold))
                                        Text("\(g.xp) XP").font(Typo.rounded(12, .semibold)).opacity(0.8)
                                    }
                                }
                                .buttonStyle(TileStyle(state: lib.profile.dailyGoalXP == g.xp ? .selected : .normal, minHeight: 58, alignment: .center))
                            }
                        }
                    }
                    section("Reminder") {
                        Toggle(isOn: Binding(get: { reminderOn }, set: { reminderOn = $0; updateReminder(on: $0) })) { Text("Daily reminder").font(Typo.bodyBold).foregroundStyle(Palette.ink) }
                            .tint(Palette.green)
                        if reminderOn {
                            DatePicker("Time", selection: Binding(get: { reminderTime }, set: { reminderTime = $0; updateReminder(on: true) }), displayedComponents: .hourAndMinute)
                                .font(Typo.body)
                        }
                    }
                    section("Smart organize") {
                        HStack(spacing: 8) {
                            Circle().fill(store.smartOn ? Palette.green : Palette.lineStrong).frame(width: 10, height: 10)
                            Text(store.smartOn ? "Smart organize: on" : "Smart organize: off").font(Typo.bodyBold).foregroundStyle(Palette.ink)
                            if checking { ProgressView().controlSize(.small) }
                        }
                        Text("Paste the address of your OpenStudy web app to sort and build lessons with Claude. Leave it empty to stay fully offline.")
                            .font(Typo.rounded(14, .medium)).foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        TextField("https://your-openstudy.app", text: $server)
                            .font(Typo.body)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .submitLabel(.done)
                            .padding(14)
                            .background(RoundedRectangle(cornerRadius: 14).fill(Palette.shelf))
                            .onSubmit(saveServer)
                        Button("Save and check", action: saveServer).buttonStyle(.chunky(.secondary, height: 46))
                    }
                    section("Library") {
                        if let exportURL {
                            ShareLink(item: exportURL) {
                                Label("Export library", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.chunky(.secondary))
                        }
                        Button { importing = true } label: { Label("Import library", systemImage: "square.and.arrow.down") }
                            .buttonStyle(.chunky(.secondary))
                        if let importResult { Text(importResult).font(Typo.small).foregroundStyle(Palette.muted) }
                        Text("The file works with the OpenStudy web app too. Images stay on this iPhone.")
                            .font(Typo.rounded(14, .medium)).foregroundStyle(Palette.muted)
                        Button("Reset everything", role: .destructive) { confirmReset = true }
                            .buttonStyle(.chunky(.custom(fill: Palette.paper, lip: Palette.redSoft, text: Palette.redText)))
                            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.redSoft, lineWidth: 2).padding(.bottom, 4))
                    }
                    Text("\(lib.stats.xp) XP total, longest streak \(lib.stats.longestStreak) \(lib.stats.longestStreak == 1 ? "day" : "days"), \(lib.stats.freezes) streak \(lib.stats.freezes == 1 ? "freeze" : "freezes")")
                        .font(Typo.small).foregroundStyle(Palette.muted)
                }
                .padding(20)
            }
        }
        .background(Palette.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            reminderOn = lib.profile.reminder != nil
            reminderTime = Reminders.date(from: lib.profile.reminder)
            server = store.smartServer
            exportURL = store.exportFile()
            DispatchQueue.main.async { ready = true }
        }
        .onChange(of: store.library) { _, _ in exportURL = store.exportFile() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            if case .success(let url) = result, store.importLibrary(from: url) { importResult = "Library merged." }
            else { importResult = "That file could not be read." }
        }
        .confirmationDialog("Reset everything?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Delete all books and progress", role: .destructive) { store.reset() }
        } message: { Text("This removes every book, page, lesson and your streak from this iPhone. Export first if you want a copy.") }
    }

    func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(Typo.headline).foregroundStyle(Palette.ink)
            content()
        }
    }

    func weekStat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(Typo.rounded(17, .heavy)).foregroundStyle(Palette.ink).lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(Typo.rounded(12, .semibold)).foregroundStyle(Palette.muted).lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, minHeight: 64)
        .background(RoundedRectangle(cornerRadius: 14).fill(Palette.shelf))
    }

    func chips(_ choices: [Choice], selected: [String], toggle: @escaping (String) -> Void) -> some View {
        FlowLayout(spacing: 8, lineSpacing: 8) {
            ForEach(choices) { c in
                Button { toggle(c.id) } label: {
                    Label(c.title, systemImage: selected.contains(c.id) ? "checkmark" : c.icon).font(Typo.rounded(15, .bold))
                }
                .buttonStyle(ChipStyle(state: selected.contains(c.id) ? .selected : .normal))
            }
        }
    }

    func toggle(_ key: WritableKeyPath<Profile, [String]>, _ id: String) {
        var list = store.library.profile[keyPath: key]
        if let i = list.firstIndex(of: id) { if list.count > 1 { list.remove(at: i) } } else { list.append(id) }
        store.library.profile[keyPath: key] = list
    }

    func dayLetter(_ daysAgo: Int) -> String {
        let d = Calendar.current.date(byAdding: .day, value: -daysAgo, to: Date())!
        let f = DateFormatter(); f.dateFormat = "EEEEE"
        return f.string(from: d)
    }

    func updateReminder(on: Bool) {
        if on {
            Task {
                let ok = await Reminders.request()
                if ok {
                    let s = Reminders.string(from: reminderTime)
                    store.library.profile.reminder = s
                    Reminders.schedule(s)
                } else {
                    reminderOn = false
                    store.toast = "Notifications are off in iOS Settings"
                }
            }
        } else {
            store.library.profile.reminder = nil
            Reminders.schedule(nil)
        }
    }

    func saveServer() {
        store.objectWillChange.send()
        store.smartServer = server.trimmingCharacters(in: .whitespacesAndNewlines)
        checking = true
        Task {
            await store.refreshSmartStatus()
            checking = false
        }
    }
}
